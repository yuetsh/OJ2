import type { TrialRunResponse } from "@oj2/contract"

import { config } from "../config"
import { postJudge, statusValue, type JudgeCase, type JudgeResponse } from "./run"
import { nativeRuntimeError, parsePythonTraceback } from "./runtime-diagnosis"
import { JudgeStatus, type JudgeStatusValue } from "./status"

/**
 * 试运行：「运行例子」「自己输入」、后台「生成测试点」。
 *
 * 原来走的是另一台 Judge0（C 是 GCC 9、编译参数也不一样），例子上的结果偶尔和提交对不上。
 * 现在和提交用同一台判题机、同一套编译命令（languages.ts），但**不进 BullMQ**：
 * 学生在页面上等着看结果，排进判题队列要和正式提交抢那两个 worker。
 *
 * 判题机是和正式提交共用的，所以这里自己排一道队：
 * - 全站同时最多 `TRIAL_CONCURRENCY` 批在判题机上跑，其余按先来后到等；
 * - 一个人同时最多两批（「运行例子」和「自己输入」可以同时点），再多直接拒；
 * - 等的人太多、或者等得太久，也直接拒，让学生过一会儿再点，别无限挂着。
 *
 * 队列在进程内：api 只有一个进程，机房和服务器各有各的 api 和判题机，
 * 各排各的正好。
 */

const MAX_WAITING = 60
const WAIT_TIMEOUT_MS = 30_000
const PER_USER_LIMIT = 2
/** 判题机本身有编译、运行的限时，这里只防它卡死不回 */
const JUDGE_TIMEOUT_MS = 60_000

/**
 * 判题机回包的总上限。判题机给每组输出留 16MB（见镜像里 judge_client.py 的
 * max_output_size），死循环打印能把每组都写满；api 容器只有 512MB，十组全满
 * 读进来再 JSON.parse 一遍就是好几百 MB。超了就掐断，告诉学生输出太多了。
 */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

/** 回给学生的每组输出最多这么长。管理员生成测试点要原样的输出，不截 */
const STUDENT_OUTPUT_LIMIT = 64 * 1024

export class TrialBusyError extends Error {}
export class TrialUserLimitError extends Error {}

let active = 0
const waiting: (() => void)[] = []
const perUser = new Map<number, number>()

function release() {
  const next = waiting.shift()
  if (next) next()
  else active--
}

async function acquire() {
  if (active < config.trialConcurrency) {
    active++
    return
  }
  if (waiting.length >= MAX_WAITING) throw new TrialBusyError()
  await new Promise<void>((resolve, reject) => {
    const wake = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      const index = waiting.indexOf(wake)
      if (index >= 0) waiting.splice(index, 1)
      reject(new TrialBusyError())
    }, WAIT_TIMEOUT_MS)
    waiting.push(wake)
  })
  // 被 release() 叫醒时名额是直接转交过来的，active 不用再加
}

/** 边读边数，超过上限就掐断连接，返回 null */
async function readCapped(response: Response, limit: number) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function truncate(text: string) {
  return text.length > STUDENT_OUTPUT_LIMIT
    ? `${text.slice(0, STUDENT_OUTPUT_LIMIT)}\n……（输出太长，后面的没有显示）`
    : text
}

export async function runTrial(options: {
  userId: number
  language: string
  /** 送去判题机的完整代码（套过题目模板） */
  source: string
  /** 学生自己写的那段，和模板拼在前面的行数：运行时错误的行号要扣掉模板才对得上编辑器 */
  code: string
  prependLines: number
  timeLimit: number
  memoryLimit: number
  cases: { input: string; output?: string }[]
  /** 管理员生成测试点要完整输出 */
  fullOutput: boolean
}): Promise<TrialRunResponse> {
  const inFlight = perUser.get(options.userId) ?? 0
  if (inFlight >= PER_USER_LIMIT) throw new TrialUserLimitError()
  perUser.set(options.userId, inFlight + 1)
  try {
    await acquire()
    try {
      return await judgeTrial(options)
    } finally {
      release()
    }
  } finally {
    const left = (perUser.get(options.userId) ?? 1) - 1
    if (left > 0) perUser.set(options.userId, left)
    else perUser.delete(options.userId)
  }
}

async function judgeTrial(options: Parameters<typeof runTrial>[0]): Promise<TrialRunResponse> {
  const response = await postJudge(
    options.language,
    options.source,
    options.timeLimit,
    options.memoryLimit,
    // 输入补结尾换行，和 checkSamples 一样：题面上的例子常常没有，测试点文件都有
    options.cases.map((item) => ({
      input: item.input.endsWith("\n") || item.input === "" ? item.input : `${item.input}\n`,
      output: item.output ?? "",
    })),
    { output: true, signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS) },
  )
  const body = await readCapped(response, MAX_RESPONSE_BYTES)
  if (body === null) return { status: "too-much-output" }

  const parsed = JSON.parse(body) as JudgeResponse
  if (parsed.err) {
    if (parsed.err === "CompileError") {
      return {
        status: "compile-error",
        message: typeof parsed.data === "string" ? parsed.data : "",
      }
    }
    throw new Error(`JudgeServer error ${parsed.err}: ${JSON.stringify(parsed.data)}`)
  }
  if (!Array.isArray(parsed.data)) throw new Error("JudgeServer returned an invalid result payload")

  const byIndex = new Map(
    (parsed.data as JudgeCase[]).map((item) => [Number(item.test_case), item]),
  )
  return {
    status: "done",
    cases: options.cases.map((item, index) => {
      // 判题机给内联测试点编号是从 1 起的（server.py 里 `index += 1`）
      const judged = byIndex.get(index + 1)
      if (!judged) return { result: JudgeStatus.SYSTEM_ERROR, output: "" }
      let result: JudgeStatusValue = statusValue(judged.result)
      // 没给正确输出的组，判题机拿空串比，跑通了也是答案错误 —— 这里只看有没有出错
      if (item.output === undefined && result === JudgeStatus.WRONG_ANSWER) {
        result = JudgeStatus.ACCEPTED
      }
      const output = typeof judged.output === "string" ? judged.output : ""
      // 运行时错误和提交用同一个解析（judge/runtime-diagnosis.ts）：第几行、什么异常。
      // 提交那边要重跑一次才拿得到回溯，这里 output 本来就开着，直接解析
      const runtimeError =
        result === JudgeStatus.RUNTIME_ERROR
          ? options.language === "Python"
            ? parsePythonTraceback(output, options.code, options.prependLines)
            : nativeRuntimeError(judged.signal, judged.exit_code)
          : null
      return {
        result,
        output: options.fullOutput ? output : truncate(output),
        ...(runtimeError ? { runtimeError } : {}),
      }
    }),
  }
}
