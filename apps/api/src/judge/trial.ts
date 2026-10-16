import type { TrialRunResponse } from "@oj2/contract"

import { config } from "../config"
import {
  MAX_RESPONSE_BYTES,
  postJudge,
  readCapped,
  statusValue,
  type JudgeCase,
  type JudgeResponse,
} from "./run"
import { nativeRuntimeError, parsePythonTraceback } from "./runtime-diagnosis"
import { withJudgeSlot, type JudgePool } from "./slots"
import { JudgeStatus, type JudgeStatusValue } from "./status"
import { shiftCompileLines } from "./template"

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
 * 这道队在进程内，管的是排队上限、每人两批和先来后到；判题机上真正同时跑几批由
 * judge/slots.ts 的交互池管（和提交前的编译检查共用，跨 api / worker 两个进程）。
 * 机房和服务器各有各的 api、Redis 和判题机，各排各的正好。
 */

const MAX_WAITING = 60
const WAIT_TIMEOUT_MS = 30_000
const PER_USER_LIMIT = 2
/** 判题机本身有编译、运行的限时，这里只防它卡死不回 */
const JUDGE_TIMEOUT_MS = 60_000

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
  /** 判题机名额从哪个池拿，默认交互池；流程图评分是后台的，走 judge */
  pool?: JudgePool
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

/**
 * 进程内那道队排到了，还要在判题机的名额池里拿到一个（judge/slots.ts）：
 * 编译检查和这里共用交互池，流程图评分走后台池。等名额也算在 WAIT_TIMEOUT_MS 里，
 * 等不到一样让学生过一会儿再点。
 */
async function judgeTrial(options: Parameters<typeof runTrial>[0]): Promise<TrialRunResponse> {
  const wait = AbortSignal.timeout(WAIT_TIMEOUT_MS)
  try {
    return await withJudgeSlot(
      options.pool ?? "interactive",
      { holdMs: JUDGE_TIMEOUT_MS + 30_000, signal: wait },
      () => judgeTrialNow(options),
    )
  } catch (error) {
    if (wait.aborted && error === wait.reason) throw new TrialBusyError()
    throw error
  }
}

async function judgeTrialNow(options: Parameters<typeof runTrial>[0]): Promise<TrialRunResponse> {
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
        message:
          typeof parsed.data === "string"
            ? shiftCompileLines(parsed.data, options.prependLines)
            : "",
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
