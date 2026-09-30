import { createHash } from "node:crypto"

import { astRuleSchema, type ContestSubmissionInfo, type StatisticInfo } from "@oj2/contract"
import { and, eq, inArray } from "drizzle-orm"

import { config } from "../config"
import { db, schema } from "../db"
import { publishAchievementNotification } from "../events"
import { updateAchievementsForSubmission } from "../services/achievements"
import { recordSolvedAndNotify } from "../services/problemset"
import { checkAst, type AstRule } from "./ast"
import { publishSubmissionUpdate } from "./events"
import { asRecord } from "../routes/helpers"
import type { JudgeJobData } from "./job"
import { judgeConfigFor } from "./languages"
import { isAccepted, JudgeStatus, type JudgeStatusValue } from "./status"
import { parseProblemTemplate, shiftCompileLines } from "./template"
import { runSqlCase } from "./sql"
import {
  nativeRuntimeError,
  parsePythonTraceback,
  type RuntimeErrorInfo,
} from "./runtime-diagnosis"
import { readInfo } from "../services/test-case"
import { readFile } from "node:fs/promises"
import { resolve as resolvePath } from "node:path"

export interface JudgeCase {
  cpu_time: number
  memory: number
  result: number
  test_case: string
  /** SQL 判题会带上中文原因，沙箱判题没有这个字段 */
  error_message?: string | null
  [key: string]: unknown
}

export interface JudgeResponse {
  err: string | null
  data: JudgeCase[] | unknown
}

export function statusValue(value: number): JudgeStatusValue {
  const statuses = new Set<number>(Object.values(JudgeStatus))
  return statuses.has(value) ? (value as JudgeStatusValue) : JudgeStatus.SYSTEM_ERROR
}

export function templateForLanguage(value: unknown, language: string) {
  const template = asRecord(value)[language]
  return typeof template === "string" ? template : null
}

/**
 * 取某个语言的 AST 规则。逐条过 astRuleSchema 而不是整片 `as AstRule[]` 硬转 ——
 * 这是从库里读出来的 JSONB，形状不对（比如 engine 是个 evaluateRule 不认识的值）
 * 时丢掉那一条，行为和 evaluateRule 的 `default: return null` 一致，只是提前到了
 * 这里、并且不再骗类型系统。
 */
function astRulesForLanguage(value: unknown, language: string): AstRule[] {
  const rules = asRecord(value)[language]
  if (!Array.isArray(rules)) return []
  return rules.flatMap((rule) => {
    const parsed = astRuleSchema.safeParse(rule)
    return parsed.success ? [parsed.data] : []
  })
}

/**
 * `testCase` 是测试点目录名（正常判题），或者内联的测试点（诊断重跑，见
 * diagnoseRuntimeError）。`output` 只在诊断和试运行时打开：它让判题机把每个测试点的
 * 程序输出原样带回来，正常判题开着的话，死循环打印能把 worker 内存撑爆。
 *
 * 只发请求、不读响应体：试运行（judge/trial.ts）要边读边数字节，超了就掐断。
 */
export async function postJudge(
  language: string,
  code: string,
  timeLimit: number,
  memoryLimit: number,
  testCase: string | { input: string; output: string }[],
  { output = false, signal }: { output?: boolean; signal?: AbortSignal } = {},
) {
  const languageConfig = judgeConfigFor(language)
  if (!languageConfig) throw new Error(`Unsupported judge language: ${language}`)

  const token = createHash("sha256").update(config.judgeServerToken).digest("hex")
  const response = await fetch(new URL("/judge", config.judgeServerUrl), {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "X-Judge-Server-Token": token,
    },
    body: JSON.stringify({
      language_config: languageConfig,
      src: code,
      max_cpu_time: timeLimit,
      max_memory: 1024 * 1024 * memoryLimit,
      ...(typeof testCase === "string" ? { test_case_id: testCase } : { test_case: testCase }),
      output,
      io_mode: {
        io_mode: "Standard IO",
        input: "input.txt",
        output: "output.txt",
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`JudgeServer returned HTTP ${response.status}`)
  }
  return response
}

async function requestJudge(
  language: string,
  code: string,
  timeLimit: number,
  memoryLimit: number,
  testCase: string | { input: string; output: string }[],
  output = false,
) {
  const response = await postJudge(language, code, timeLimit, memoryLimit, testCase, { output })
  return (await response.json()) as JudgeResponse
}

async function persistResult(
  submissionId: string,
  problemId: number,
  userId: number,
  displayId: string,
  result: JudgeStatusValue,
  info: unknown,
  statisticInfo: Record<string, unknown>,
  contestId: number | null,
  submissionCreateTime: string,
  /** 重判之前**已经记过账**的结果；新提交、或原来没记过账（系统错误）时为 null */
  counted: JudgeStatusValue | null,
) {
  return db.transaction(async (tx) => {
    const [currentSubmission] = await tx
      .select({ result: schema.submission.result })
      .from(schema.submission)
      .where(eq(schema.submission.id, submissionId))
      .for("update")

    if (
      !currentSubmission ||
      ![JudgeStatus.PENDING, JudgeStatus.JUDGING].includes(currentSubmission.result as 6 | 7)
    ) {
      return false
    }

    const [problem] = await tx
      .select({
        submissionNumber: schema.problem.submissionNumber,
        acceptedNumber: schema.problem.acceptedNumber,
        statisticInfo: schema.problem.statisticInfo,
      })
      .from(schema.problem)
      .where(eq(schema.problem.id, problemId))
      .for("update")

    const [profile] = await tx
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, userId))
      .for("update")

    if (!problem || !profile) {
      throw new Error("Submission dependencies disappeared during judging")
    }

    await tx
      .update(schema.submission)
      .set({ result, info, statisticInfo })
      .where(eq(schema.submission.id, submissionId))

    /**
     * 重判只做差量：提交数不动，旧结果那一格减一、新结果那一格加一，通过数按新旧结果
     * 调整。原来重判一律当新提交记账，老师上课对一条连点三次重判，这道题的提交数和
     * 通过数就各多三（旧栈的 update_problem_status_rejudge 也是只做差量）
     */
    const problemStatistics = asRecord(problem.statisticInfo)
    const bump = (key: string, delta: number) => {
      const value = problemStatistics[key]
      problemStatistics[key] = Math.max(0, (typeof value === "number" ? value : 0) + delta)
    }
    bump(String(result), 1)
    if (counted !== null) bump(String(counted), -1)
    const acceptedDelta =
      (isAccepted(result) ? 1 : 0) - (counted !== null && isAccepted(counted) ? 1 : 0)

    await tx
      .update(schema.problem)
      .set({
        submissionNumber: problem.submissionNumber + (counted === null ? 1 : 0),
        acceptedNumber: Math.max(0, problem.acceptedNumber + acceptedDelta),
        statisticInfo: problemStatistics,
      })
      .where(eq(schema.problem.id, problemId))

    const acmStatus = asRecord(profile.acmProblemsStatus)
    const statusKey = contestId === null ? "problems" : "contest_problems"
    const problems = asRecord(acmStatus[statusKey])
    const previous = asRecord(problems[String(problemId)])
    const previousStatus = previous.status
    const wasAccepted = typeof previousStatus === "number" && isAccepted(previousStatus)
    const acceptedNow = isAccepted(result)

    if (previousStatus === undefined) {
      problems[String(problemId)] = {
        status: acceptedNow ? JudgeStatus.ACCEPTED : result,
        _id: displayId,
      }
    } else if (!wasAccepted) {
      problems[String(problemId)] = {
        ...previous,
        status: acceptedNow ? JudgeStatus.ACCEPTED : result,
        _id: displayId,
      }
    }
    acmStatus[statusKey] = problems

    await tx
      .update(schema.userProfile)
      .set({
        // 重判不是又交了一次。个人的通过数只在「第一次做对」时加，重判改错了也不收回
        // （他可能别的提交也对了），和 acm_problems_status 同一个口径
        submissionNumber:
          profile.submissionNumber + (contestId === null && counted === null ? 1 : 0),
        acceptedNumber:
          profile.acceptedNumber + (contestId === null && acceptedNow && !wasAccepted ? 1 : 0),
        acmProblemsStatus: acmStatus,
      })
      .where(eq(schema.userProfile.id, profile.id))

    if (contestId !== null) {
      const [contest] = await tx
        .select({ startTime: schema.contest.startTime })
        .from(schema.contest)
        .where(eq(schema.contest.id, contestId))
        .for("update")
      if (!contest) throw new Error("Contest disappeared during judging")

      await tx
        .insert(schema.acmContestRank)
        .values({
          contestId,
          userId,
          submissionNumber: 0,
          acceptedNumber: 0,
          totalTime: 0,
          submissionInfo: {},
        })
        .onConflictDoNothing({
          target: [schema.acmContestRank.contestId, schema.acmContestRank.userId],
        })

      const [rank] = await tx
        .select()
        .from(schema.acmContestRank)
        .where(
          and(
            eq(schema.acmContestRank.contestId, contestId),
            eq(schema.acmContestRank.userId, userId),
          ),
        )
        .for("update")
      if (!rank) throw new Error("Contest rank could not be created")

      const rankInfo = rank.submissionInfo
      const previousInfo = rankInfo[String(problemId)]
      const alreadyAccepted = previousInfo?.is_ac === true
      if (!alreadyAccepted) {
        const errorNumber = previousInfo?.error_number ?? 0
        const nextInfo: ContestSubmissionInfo = {
          is_ac: acceptedNow,
          ac_time: 0,
          error_number:
            errorNumber + (!acceptedNow && result !== JudgeStatus.COMPILE_ERROR ? 1 : 0),
          is_first_ac: false,
        }
        let totalTime = rank.totalTime
        let acceptedNumber = rank.acceptedNumber
        if (acceptedNow) {
          const acTime = Math.max(
            0,
            Math.floor((Date.parse(submissionCreateTime) - Date.parse(contest.startTime)) / 1000),
          )
          nextInfo.ac_time = acTime
          nextInfo.is_first_ac = problem.acceptedNumber === 0
          acceptedNumber += 1
          totalTime += acTime + errorNumber * 20 * 60
        }
        rankInfo[String(problemId)] = nextInfo
        await tx
          .update(schema.acmContestRank)
          .set({
            submissionNumber: rank.submissionNumber + 1,
            acceptedNumber,
            totalTime,
            submissionInfo: rankInfo,
          })
          .where(eq(schema.acmContestRank.id, rank.id))
      }
    }

    return true
  })
}

async function markSystemError(submissionId: string, userId: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const updated = await db
    .update(schema.submission)
    .set({
      result: JudgeStatus.SYSTEM_ERROR,
      statisticInfo: { err_info: message, score: 0 },
    })
    .where(
      and(
        eq(schema.submission.id, submissionId),
        inArray(schema.submission.result, [JudgeStatus.PENDING, JudgeStatus.JUDGING]),
      ),
    )
    .returning({ id: schema.submission.id })

  if (updated.length > 0) {
    await publishSubmissionUpdate(userId, {
      type: "submission_update",
      submissionId,
      result: JudgeStatus.SYSTEM_ERROR,
      status: "error",
    })
  }
}

/**
 * 判题任务在 `judgeSubmission` 之外失败时的兜底。
 *
 * 正常路径上的异常都被 judgeSubmission 自己的 try/catch 接住、落成 SYSTEM_ERROR
 * 并且推给前端，所以能走到队列 `failed` 事件的只剩两种：取提交那一步就炸了，
 * 以及**worker 进程中途死掉** —— 机房断电、容器 OOM 被杀、部署时重启。后一种
 * BullMQ 会先按 stalled 重入队一次，再没人接就彻底放手；判题队列又没配 attempts，
 * 失败即终局。没有这个兜底，那条提交就永远停在「等待评分」，学生看着转圈，
 * 教师统计里它还占着一个「判题中」的名额。生产库里 3 条卡死的 PENDING
 * （2022-11 / 2026-03 / 2026-04，都是旧栈时代留下的）就是这么来的。
 *
 * `markSystemError` 只动 PENDING / JUDGING 两个状态，所以判完了的、被重判改过的
 * 都不会被它覆盖。唯一能撞上的是「重判刚把状态置回 PENDING，同一刻上一个被遗弃的
 * 任务才失败」——结果是这次重判被吃掉、显示成系统错误，比静默卡死看得见。
 */
export async function failAbandonedSubmission(submissionId: string, error: unknown) {
  const [row] = await db
    .select({ userId: schema.submission.userId })
    .from(schema.submission)
    .where(eq(schema.submission.id, submissionId))
    .limit(1)
  if (!row) return
  await markSystemError(submissionId, row.userId, error)
}

/**
 * 运行时错误的诊断，结果写进 `statistic_info.runtime_error`（字段说明见契约）。
 *
 * C / C++ 直接用失败测试点的信号和退出码。Python 要拿回溯，得**重跑那一个测试点**：
 * 主判题不开 output（理由见 requestJudge），所以这里读出第一个失败测试点的输入，
 * 以内联测试点的形式单独再跑一次、打开 output。同样的代码、同样的输入，抛的是
 * 同一个异常。只多跑一个点，而且只在 Python 判出运行时错误时才跑。
 *
 * 诊断失败（读不到测试点、判题机没回回溯）就不写这个字段，学生看到的和原来一样。
 */
export async function diagnoseRuntimeError(
  row: {
    submission: typeof schema.submission.$inferSelect
    problem: typeof schema.problem.$inferSelect
  },
  source: string,
  prependLines: number,
  failed: JudgeCase,
): Promise<RuntimeErrorInfo | null> {
  if (row.submission.language !== "Python")
    return nativeRuntimeError(failed.signal, failed.exit_code)

  const info = await readInfo(row.problem.testCaseId)
  const inputName = info?.test_cases?.[failed.test_case]?.input_name
  if (!inputName) return null
  const input = await readFile(
    resolvePath(config.testCaseDirectory, row.problem.testCaseId, inputName),
    "utf8",
  )
  const response = await requestJudge(
    row.submission.language,
    source,
    row.problem.timeLimit,
    row.problem.memoryLimit,
    [{ input, output: "" }],
    true,
  )
  const output = Array.isArray(response.data) ? response.data[0]?.output : null
  if (typeof output !== "string") return null
  return parsePythonTraceback(output, row.submission.code, prependLines)
}

/** sample_check 里三段文本各自的上限。样例本身很短，截的主要是学生的输出（死循环打印） */
const SAMPLE_TEXT_LIMIT = 2000

type SampleCheck = NonNullable<StatisticInfo["sample_check"]>

/**
 * 答案错误时拿题目的**公开样例**重跑一次，记下第一个没过的样例和学生在它上面的输出，
 * 写进 `statistic_info.sample_check`。
 *
 * 2025 秋以来的 6901 条答案错误在样例上重跑过：73% 在样例上就已经错了。样例写在题面上，
 * 所以「输入 700，正确输出 7，你的输出 007」给学生看不泄露任何隐藏数据，而这正是他最
 * 缺的线索 —— 原来答案错误只有四个字，连错在哪一类都不知道。其中约三分之一只差格式
 * （多了提示文字、空格换行、中英文标点、小数位数），前端按差异类型再补一句中文提示。
 *
 * 和运行时错误的诊断一样，主判题不开 output；这里的样例是内联传的，输出只回这几个点。
 */
async function checkSamples(
  row: {
    submission: typeof schema.submission.$inferSelect
    problem: typeof schema.problem.$inferSelect
  },
  source: string,
): Promise<SampleCheck | null> {
  const samples = (Array.isArray(row.problem.samples) ? row.problem.samples : [])
    .map((item) => asRecord(item))
    .filter(
      (item): item is { input: string; output: string } =>
        typeof item.input === "string" && typeof item.output === "string",
    )
  if (!samples.length) return null

  const response = await requestJudge(
    row.submission.language,
    source,
    row.problem.timeLimit,
    row.problem.memoryLimit,
    // 题面上的样例输入常常没有结尾换行，而 input() 读到文件末尾没有换行照样能读，
    // C 的 scanf 也不在乎。补一个是为了和测试点文件的样子一致
    samples.map((item) => ({
      input: item.input.endsWith("\n") ? item.input : `${item.input}\n`,
      output: item.output,
    })),
    true,
  )
  // 在样例上就编译不过不会发生（正式判题刚编译过同一份代码），真遇到了就当没检查
  if (response.err || !Array.isArray(response.data)) return null
  const cases = [...(response.data as JudgeCase[])].sort(
    (left, right) => Number(left.test_case) - Number(right.test_case),
  )
  const index = cases.findIndex((item) => item.result !== JudgeStatus.ACCEPTED)
  if (index < 0) return { passed: true }
  const sample = samples[index]!
  const output = cases[index]!.output
  return {
    passed: false,
    index,
    input: sample.input.slice(0, SAMPLE_TEXT_LIMIT),
    expected: sample.output.slice(0, SAMPLE_TEXT_LIMIT),
    output: typeof output === "string" ? output.slice(0, SAMPLE_TEXT_LIMIT) : "",
    result: cases[index]!.result,
  }
}

/**
 * 重判之前的结果**有没有记过账**。判完的结果都走过 persistResult、记过一次；
 * 还在判的（卡在队列里被重判）和系统错误（markSystemError 只改结果、不动计数）没有，
 * 重判时要当新提交记一次。判题机自己回的系统错误其实记过账，这里分不出来，按没记过算 ——
 * 多记一次好过把别人的计数减掉
 */
function countedBefore(rejudgedFrom: number | undefined): JudgeStatusValue | null {
  if (rejudgedFrom === undefined) return null
  if (
    rejudgedFrom === JudgeStatus.PENDING ||
    rejudgedFrom === JudgeStatus.JUDGING ||
    rejudgedFrom === JudgeStatus.SYSTEM_ERROR
  ) {
    return null
  }
  return rejudgedFrom as JudgeStatusValue
}

export async function judgeSubmission(job: JudgeJobData) {
  const [row] = await db
    .select({
      submission: schema.submission,
      problem: schema.problem,
    })
    .from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .where(and(eq(schema.submission.id, job.submissionId), eq(schema.problem.id, job.problemId)))
    .limit(1)

  if (!row) throw new Error(`Submission ${job.submissionId} does not exist`)
  if (![JudgeStatus.PENDING, JudgeStatus.JUDGING].includes(row.submission.result as 6 | 7)) {
    return
  }

  try {
    await db
      .update(schema.submission)
      .set({ result: JudgeStatus.JUDGING })
      .where(eq(schema.submission.id, row.submission.id))
    await publishSubmissionUpdate(row.submission.userId, {
      type: "submission_update",
      submissionId: row.submission.id,
      result: JudgeStatus.JUDGING,
      status: "judging",
    })

    const rawTemplate = templateForLanguage(row.problem.template, row.submission.language)
    const template = rawTemplate ? parseProblemTemplate(rawTemplate) : null
    const source = template
      ? `${template.prepend}\n${row.submission.code}\n${template.append}`
      : row.submission.code

    // SQL 题不经判题沙箱：沙箱是给编译型/脚本型语言用的，SQL 判的是结果集，
    // 走 judge/sql 的 WASM 引擎（在独立子进程里跑，见那边的说明）。
    const response =
      row.submission.language === "SQL"
        ? await judgeSqlSubmission(row.problem, row.submission.code)
        : await requestJudge(
            row.submission.language,
            source,
            row.problem.timeLimit,
            row.problem.memoryLimit,
            row.problem.testCaseId,
          )

    let result: JudgeStatusValue
    let info: unknown = {}
    let statisticInfo: Record<string, unknown> = {}

    if (response.err) {
      const errInfo =
        typeof response.data === "string" ? response.data : JSON.stringify(response.data)
      // 只有 CompileError 是学生的错。别的（JudgeClientError 的「Test case not found」
      // 这类）是题目或判题机的问题：原来一律记成编译错误，学生看到一句英文、以为自己写错了，
      // 全库 337 条，最近一条就在 2026-09。
      if (response.err === "CompileError") {
        result = JudgeStatus.COMPILE_ERROR
        statisticInfo = {
          err_info: shiftCompileLines(errInfo, template ? template.prepend.split("\n").length : 0),
          score: 0,
        }
      } else {
        console.warn(`[judge] 判题机报错 ${row.submission.id}: ${response.err} ${errInfo}`)
        result = JudgeStatus.SYSTEM_ERROR
        statisticInfo = { err_info: errInfo, score: 0 }
      }
    } else {
      if (!Array.isArray(response.data)) {
        throw new Error("JudgeServer returned an invalid result payload")
      }
      const cases = [...response.data].sort(
        (left, right) => Number(left.test_case) - Number(right.test_case),
      )
      info = { err: null, data: cases }
      const firstFailure = cases.find((item) => item.result !== JudgeStatus.ACCEPTED)
      result = statusValue(firstFailure?.result ?? JudgeStatus.ACCEPTED)
      statisticInfo = {
        time_cost: Math.max(0, ...cases.map((item) => Number(item.cpu_time) || 0)),
        memory_cost: Math.max(0, ...cases.map((item) => Number(item.memory) || 0)),
        score: 0,
      }
      // SQL 判题给出的中文提示（只读拒绝/超时/内存/无结果集）只存在测试点的
      // error_message 里，而前端只读 statistic_info.err_info。把首个失败测试点的
      // 提示提上来，否则学生只看到一个 WA 却不知道原因。对齐旧 sql_dispatcher。
      const failedMessage = cases.find(
        (item) => item.result !== JudgeStatus.ACCEPTED && item.error_message,
      )?.error_message
      if (typeof failedMessage === "string") statisticInfo.err_info = failedMessage

      // 比赛不诊断：ACM 只报对错，和「通过几个测试点」、AI 提示不给比赛提交同一个口径
      if (
        result === JudgeStatus.RUNTIME_ERROR &&
        firstFailure &&
        row.submission.contestId === null
      ) {
        const prependLines = template ? template.prepend.split("\n").length : 0
        const diagnosis = await diagnoseRuntimeError(row, source, prependLines, firstFailure).catch(
          (error: unknown) => {
            console.warn(`[judge] 运行时错误诊断失败 ${row.submission.id}:`, error)
            return null
          },
        )
        if (diagnosis) statisticInfo.runtime_error = diagnosis
      }

      // 同上，比赛不跑：比赛里有期末考试，格式提示在那里不该给
      if (
        result === JudgeStatus.WRONG_ANSWER &&
        row.submission.contestId === null &&
        row.submission.language !== "SQL"
      ) {
        const check = await checkSamples(row, source).catch((error: unknown) => {
          console.warn(`[judge] 样例重跑失败 ${row.submission.id}:`, error)
          return null
        })
        if (check) statisticInfo.sample_check = check
      }

      if (result === JudgeStatus.ACCEPTED) {
        const rules = astRulesForLanguage(row.problem.astRules, row.submission.language)
        if (rules.length > 0) {
          const ast = await checkAst(row.submission.code, row.submission.language, rules)
          if (!ast.passed) {
            result = JudgeStatus.AST_CHECK_FAILED
            statisticInfo.ast_results = ast.results
          }
        }
      }
    }

    const saved = await persistResult(
      row.submission.id,
      row.problem.id,
      row.submission.userId,
      row.problem.displayId,
      result,
      info,
      statisticInfo,
      row.submission.contestId,
      row.submission.createTime,
      countedBefore(job.rejudgedFrom),
    )
    if (!saved) return

    // 题单记账挪到判题这一路。以前靠前端 AC 之后回调 PUT /problem-set-progress，
    // 只认路由参数里那一个题单：从普通题库入口做出同一道题不计进度，网络一抖就静默丢失。
    // 放在最后那条 publishSubmissionUpdate("finished") 之前 —— 前端收到「判完了」时
    // 进度已经落库，跳回题单页看到的就是新数据。
    // 比赛题不进题单（题单加题时卡了 contestId IS NULL），跳过。
    if (row.submission.contestId === null && isAccepted(result)) {
      await recordSolvedAndNotify(
        row.submission.userId,
        row.problem.id,
        row.submission.id,
        row.submission.createTime,
      )
    }

    try {
      const unlocked = await updateAchievementsForSubmission(row.submission.id)
      await publishAchievementNotification(
        row.submission.userId,
        unlocked.map((achievement) => ({
          id: achievement.id,
          name: achievement.name,
          description: achievement.description,
          icon: achievement.icon,
          rarity: achievement.rarity,
          kind: "achievement",
        })),
      )
    } catch (error) {
      console.error(`Failed to update achievements for ${row.submission.id}`, error)
    }

    await publishSubmissionUpdate(row.submission.userId, {
      type: "submission_update",
      submissionId: row.submission.id,
      result,
      status: "finished",
      score: typeof statisticInfo.score === "number" ? statisticInfo.score : undefined,
    })
  } catch (error) {
    console.error(`Failed to judge submission ${row.submission.id}`, error)
    await markSystemError(row.submission.id, row.submission.userId, error)
  }
}

/**
 * SQL 题判题：逐个测试点用各自的初始化脚本跑一遍，产出与沙箱同构的结果结构，
 * 好让上面的状态聚合、统计、排名、WebSocket 推送逻辑完全复用。
 * 对齐旧 `judge/sql_dispatcher.py`。
 */
async function judgeSqlSubmission(
  problem: typeof schema.problem.$inferSelect,
  studentSql: string,
): Promise<JudgeResponse> {
  const sqlConfig = asRecord(problem.sqlConfig)
  const mode = sqlConfig.mode
  if (mode !== "query" && mode !== "modify") {
    throw new Error("题目缺少 SQL 配置（题型）")
  }
  const answers = Array.isArray(problem.answers) ? problem.answers : []
  const refSql = answers
    .map((item) => asRecord(item))
    .find(
      (item) => item.language === "SQL" && typeof item.code === "string" && item.code.trim(),
    )?.code
  if (typeof refSql !== "string") throw new Error("题目缺少 SQL 标准答案")

  const info = await readInfo(problem.testCaseId)
  if (!info) throw new Error("测试点信息读取失败")
  if (!info.sql) throw new Error("测试点不是 SQL 类型，请重新上传 SQL 测试点压缩包")

  // 按 "1","2",… 的数字序遍历，保证测试点顺序稳定
  const keys = Object.keys(info.test_cases ?? {}).sort((a, b) => Number(a) - Number(b))
  if (keys.length === 0) throw new Error("题目没有任何测试点")

  const cases: JudgeCase[] = []
  for (const [index, key] of keys.entries()) {
    const inputName = info.test_cases![key]!.input_name
    const initSql = await readFile(
      resolvePath(config.testCaseDirectory, problem.testCaseId, inputName),
      "utf8",
    ).catch(() => {
      throw new Error(`测试点脚本 ${inputName} 读取失败`)
    })

    const outcome = await runSqlCase({
      kind: "judge",
      initSql,
      refSql,
      studentSql,
      mode,
      orderSensitive: sqlConfig.order_sensitive === true,
      timeLimitMs: problem.timeLimit,
      memoryLimitMb: problem.memoryLimit,
    })
    if (!outcome.ok) {
      // 初始化/标准答案执行失败属出题配置问题，整题 SYSTEM_ERROR
      if (outcome.result === JudgeStatus.SYSTEM_ERROR) throw new Error(outcome.message)
      // 子进程被杀（超时/内存）也走这里，按学生错误记成一个测试点
      cases.push({
        test_case: String(index + 1),
        result: outcome.result,
        cpu_time: 0,
        real_time: 0,
        memory: 0,
        error_message: outcome.message,
      } as unknown as JudgeCase)
      break
    }
    const value = outcome.value
    value.test_case = String(index + 1)
    // 语法错误与数据无关，首个测试点即可确认，整题按编译错误处理
    // （ACM 不罚时，前端展示 err_info）
    if (index === 0 && value.result === JudgeStatus.COMPILE_ERROR) {
      return { err: "CompileError", data: value.error_message }
    }
    cases.push(value as unknown as JudgeCase)
  }
  return { err: null, data: cases }
}
