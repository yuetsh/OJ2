import {
  aiAnalysisRequestSchema,
  aiHintFeedbackRequestSchema,
  aiHintRequestSchema,
  classAnalysisRequestSchema,
  classPkAnalysisRequestSchema,
  HINT_MIN_FAILURES,
  type AiAnalysisRecord,
  type AiHintDone,
  type HintDiagnosis,
  type HeatmapItem,
  type LoginSummary,
} from "@oj2/contract"
import { and, count, countDistinct, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm"
import { Hono, type Context } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { getPreviousLogin } from "../auth/session"
import { config } from "../config"
import { db, schema } from "../db"
import { JudgeStatus } from "../judge/status"
import { failure, parseBody, readJson, success } from "../http"
import { completeChat, streamChat, streamWhole } from "../services/ai"
import { generateFilteredHint } from "../services/hint-filter"
import { accepted, buildDetail, buildDuration, listSolved } from "../services/learning-stats"
import { decideHintLevel } from "../services/hint-level"
import { hintDiagnosis, hintPrompt, referenceAnswer } from "../services/hint-diagnosis"
import { consumeToken } from "../services/throttling"
import { calendarDay, dayNumber, dayText, localTime, localWeekday } from "../time"
import { countFailedSubmissions, isTeacherOrAbove, asRecord, queryInteger } from "./helpers"

export const aiRoutes = new Hono<AppEnv>()

/**
 * 每次 AI 调用都过一遍令牌桶，复用 services/throttling 的那只桶（capacity 20 / 0.03 每秒）。
 * key 与代码提交的 `throttling:user:<id>`、流程图评分的 `flowchart:<id>` 分开计数 ——
 * 这几个端点每调用一次就是一次真金白银的 LLM 请求，以前一处限流都没有。
 */
function aiThrottleKey(userId: number) {
  return `ai:${userId}`
}

async function throttleAi(c: Context<AppEnv>) {
  const throttle = await consumeToken("user", aiThrottleKey(c.get("user")!.id))
  if (throttle.allowed) return null
  return failure(c, 429, "too-many-requests", `Please wait ${Math.floor(throttle.wait)} seconds`)
}

async function targetUser(c: Context<AppEnv>, override?: string) {
  const current = c.get("user")!
  const username = override ?? c.req.query("username")
  if (!username || !isTeacherOrAbove(current)) return current
  const [target] = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      email: schema.user.email,
      adminType: schema.user.adminType,
      problemPermission: schema.user.problemPermission,
      isDisabled: schema.user.isDisabled,
      className: schema.user.className,
    })
    .from(schema.user)
    .where(eq(schema.user.username, username))
    .limit(1)
  return target ?? null
}

aiRoutes.get("/ai/detail", requireAuth, async (c) => {
  const start = c.req.query("start")
  const end = c.req.query("end")
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return failure(c, 400, "invalid-range", "start and end must be ISO 8601 timestamps")
  }
  const user = await targetUser(c)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  return success(c, await buildDetail(user, start, end))
})

aiRoutes.get("/ai/solved", requireAuth, async (c) => {
  const start = c.req.query("start")
  const end = c.req.query("end")
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return failure(c, 400, "invalid-range", "start and end must be ISO 8601 timestamps")
  }
  const user = await targetUser(c)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  const limit = queryInteger(c.req.query("limit"), 20, { min: 1, max: 100 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  return success(c, await listSolved(user, start, end, limit, offset))
})

aiRoutes.get("/ai/duration", requireAuth, async (c) => {
  const endText = c.req.query("end")
  if (!endText || Number.isNaN(Date.parse(endText)))
    return failure(c, 400, "invalid-end", "end must be an ISO timestamp")
  const user = await targetUser(c)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  return success(c, await buildDuration(user, endText, c.req.query("duration") ?? "months:1"))
})

aiRoutes.get("/ai/heatmap", requireAuth, async (c) => {
  const user = await targetUser(c)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  const end = new Date()
  // 一格一周，共 53 格，最后一格是「本周」。周一算一周的开头（不用 GitHub 的周日）。
  // 整段以东八区的**日历日序号**为单位算（`dayNumber` / `dayText`），不构造本地 Date。
  const today = dayNumber(calendarDay(end))
  const mondayOffset = (localWeekday(today) + 6) % 7
  const firstMonday = today - mondayOffset - 52 * 7
  // SQL 两端各放宽一天：范围只用来少拉行，精确匹配靠下面按日历日 key 查表
  const date = sql<string>`date(${localTime(schema.submission.createTime)})::text`
  const rows = await db
    .select({ date, value: count() })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.userId, user.id),
        gte(schema.submission.createTime, new Date((firstMonday - 1) * 864e5).toISOString()),
        lte(schema.submission.createTime, new Date(end.getTime() + 864e5).toISOString()),
      ),
    )
    .groupBy(date)
    .orderBy(date)
  const counts = new Map(rows.map((row) => [row.date, row.value]))
  return success(
    c,
    Array.from({ length: 53 }, (_, week) => {
      const monday = firstMonday + week * 7
      let value = 0
      for (let offset = 0; offset < 7; offset++) value += counts.get(dayText(monday + offset)) ?? 0
      // timestamp 是该周周一的 UTC 零点，前端按东八区只取年月日部件
      return { timestamp: monday * 864e5, value } satisfies HeatmapItem
    }),
  )
})

aiRoutes.get("/ai/login-summary", requireAuth, async (c) => {
  const user = c.get("user")!
  const end = new Date()
  const [userRow] = await db
    .select({
      createTime: schema.user.createTime,
      lastLogin: schema.user.lastLogin,
    })
    .from(schema.user)
    .where(eq(schema.user.id, user.id))
    .limit(1)
  const previous = await getPreviousLogin(c)
  let start = new Date(
    previous ?? userRow?.lastLogin ?? userRow?.createTime ?? end.getTime() - 7 * 864e5,
  )
  if (start >= end) start = new Date(end.getTime() - 864e5)
  const range = and(
    gte(schema.submission.createTime, start.toISOString()),
    lte(schema.submission.createTime, end.toISOString()),
  )
  const [newProblems, submissions, acceptedRows, solvedRows, flowRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.problem)
      .where(
        and(
          isNull(schema.problem.contestId),
          eq(schema.problem.visible, true),
          gte(schema.problem.createTime, start.toISOString()),
          lte(schema.problem.createTime, end.toISOString()),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.submission)
      .where(and(eq(schema.submission.userId, user.id), range)),
    db
      .select({ value: count() })
      .from(schema.submission)
      .where(
        and(
          eq(schema.submission.userId, user.id),
          inArray(schema.submission.result, accepted),
          range,
        ),
      ),
    db
      .select({ value: countDistinct(schema.submission.problemId) })
      .from(schema.submission)
      .where(
        and(
          eq(schema.submission.userId, user.id),
          inArray(schema.submission.result, accepted),
          range,
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.flowchartSubmission)
      .where(
        and(
          eq(schema.flowchartSubmission.userId, user.id),
          gte(schema.flowchartSubmission.createTime, start.toISOString()),
          lte(schema.flowchartSubmission.createTime, end.toISOString()),
        ),
      ),
  ])
  const summary = {
    start: start.toISOString(),
    end: end.toISOString(),
    newProblemCount: newProblems[0]?.value ?? 0,
    submissionCount: submissions[0]?.value ?? 0,
    acceptedCount: acceptedRows[0]?.value ?? 0,
    solvedCount: solvedRows[0]?.value ?? 0,
    flowchartSubmissionCount: flowRows[0]?.value ?? 0,
  }
  let analysis = ""
  let analysisError: string | undefined
  // 这支是登录后自动触发的，没有用户点击 —— 更要过限流，否则反复刷新就是反复调模型。
  // 被限住时安静跳过：analysis 本来就是可选的，弹窗里的统计数字照常显示。
  if (
    summary.submissionCount >= 3 &&
    (await consumeToken("user", aiThrottleKey(user.id))).allowed
  ) {
    try {
      analysis = await completeChat(
        "你是 OnlineJudge 的学习助教。请根据统计数据给出简短分析(1-2句)，再给出一行以“结论：”开头的结论。",
        JSON.stringify(summary),
      )
    } catch (error) {
      analysisError = error instanceof Error ? error.message : String(error)
    }
  }
  return success(c, { summary, analysis, analysisError } satisfies LoginSummary)
})

aiRoutes.get("/ai/pinned", requireAuth, async (c) => {
  const [row] = await db
    .select({ analysis: schema.aiAnalysis, username: schema.user.username })
    .from(schema.aiAnalysis)
    .innerJoin(schema.user, eq(schema.aiAnalysis.userId, schema.user.id))
    .where(
      and(eq(schema.aiAnalysis.userId, c.get("user")!.id), eq(schema.aiAnalysis.isPinned, true)),
    )
    .limit(1)
  if (!row) return success(c, null)
  return success(c, {
    id: row.analysis.id,
    provider: row.analysis.provider,
    model: row.analysis.model,
    data: asRecord(row.analysis.data),
    analysis: row.analysis.analysis,
    createTime: row.analysis.createTime,
    isPinned: row.analysis.isPinned,
    username: row.username,
  } satisfies AiAnalysisRecord)
})

aiRoutes.post("/ai/analysis", requireAuth, async (c) => {
  const parsed = await parseBody(c, aiAnalysisRequestSchema, "start, end and duration are required")
  if (!parsed.success) return parsed.response
  if (Number.isNaN(Date.parse(parsed.data.start)) || Number.isNaN(Date.parse(parsed.data.end))) {
    return failure(c, 400, "invalid-range", "start and end must be ISO 8601 timestamps")
  }
  // 传 username 的鉴权走 targetUser：非教师传了也只会拿到自己
  const user = await targetUser(c, parsed.data.username)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  const limited = await throttleAi(c)
  if (limited) return limited
  // 学情数据一律服务端重算，客户端只说看谁、哪段时间
  // detail 现在只带聚合，逐题明细单独取一页给模型看。顺带把喂进 prompt 的条数
  // 卡在 200 —— 以前是整份 solved 无上限塞进去，题做得多的学生一次调用能顶好几倍 token
  const [details, duration, solved] = await Promise.all([
    buildDetail(user, parsed.data.start, parsed.data.end),
    buildDuration(user, parsed.data.end, parsed.data.duration),
    listSolved(user, parsed.data.start, parsed.data.end, 200, 0),
  ])
  const system =
    "你是一个风趣的编程老师。请根据学生的详细数据和每周数据给出学习建议，最后写一句鼓励的话。使用 Markdown，不要放在代码块中。"
  const prompt = `详细数据: ${JSON.stringify({ ...details, solved: solved.results })}\n每周或每月数据: ${JSON.stringify(duration)}`
  return streamChat(system, prompt, {
    onComplete: async (analysis) => {
      // 报告归被分析的那个人，不归发起请求的人 —— 教师后台的 pin 和学生侧的
      // GET /ai/pinned 都是按 user_id 找报告的，记在教师名下学生就永远看不到
      await db.insert(schema.aiAnalysis).values({
        provider: config.aiProvider,
        model: config.aiModel,
        data: { details, duration, solved: solved.results },
        systemPrompt: system,
        userPrompt: "学习详情与周期数据",
        analysis,
        createTime: new Date().toISOString(),
        userId: user.id,
        isPinned: false,
      })
    },
  })
})

/**
 * 记一条提示（成功或失败）。**失败只打日志、返回 null** —— 留痕是附带的，
 * 不能因为它写不进去就让学生看到「AI 提示生成失败」。
 */
async function recordHint(
  base: {
    submissionId: string
    startedAt: number
    promptVersion: number
    diagnosis: HintDiagnosis | null
    diagnosisError: string | null
    level: number
  },
  content: string,
  error: string | null,
  filter?: { attempt: number; blocked: boolean; reason: string | null },
) {
  try {
    const [row] = await db
      .insert(schema.aiHint)
      .values({
        submissionId: base.submissionId,
        model: config.aiModel,
        promptVersion: base.promptVersion,
        content,
        error,
        durationMs: Math.round(performance.now() - base.startedAt),
        diagnosis: base.diagnosis,
        diagnosisError: base.diagnosisError,
        level: base.level,
        // 生成就失败的那条没走到过滤，三列都留 null（分母里不该有它）
        filterAttempt: filter?.attempt ?? null,
        filterBlocked: filter?.blocked ?? null,
        filterReason: filter?.reason ?? null,
        createTime: new Date().toISOString(),
      })
      .returning({ id: schema.aiHint.id })
    return row?.id ?? null
  } catch (e) {
    console.error("Failed to record AI hint", e)
    return null
  }
}

aiRoutes.post("/ai/hint", requireAuth, async (c) => {
  const parsed = await parseBody(c, aiHintRequestSchema, "submissionId is required")
  if (!parsed.success) return parsed.response
  const [row] = await db
    .select({ submission: schema.submission, problem: schema.problem })
    .from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .where(
      and(
        eq(schema.submission.id, parsed.data.submissionId),
        eq(schema.submission.userId, c.get("user")!.id),
      ),
    )
    .limit(1)
  if (!row) return failure(c, 404, "submission-not-found", "Submission not found")
  // 比赛里不给 AI 提示，和「求助」按钮同一个口径。前端在比赛路由下压根不显示按钮，
  // 这里是防直接 POST 的那一道 —— 比赛只有 ACM 模式，提示等于变相放水。
  if (row.submission.contestId !== null)
    return failure(c, 403, "contest-hint-disabled", "Hint is disabled in contests")
  // 失败次数在端点这边也要卡一道：直接 POST 完全绕开前端的显示条件 ——
  // 不然这就是个不限次数的免费 LLM 接口。数法（判题中的不算、判题机自己崩的不算）
  // 由 countFailedSubmissions 统一，题目详情的 myFailedCount 走的是同一个函数，
  // 所以前端亮出按钮的时刻和这里放行的时刻严格对齐。
  // 编译失败不数次数（理由见 HINT_MIN_FAILURES 的注释）。放开的只是这一次提交本身，
  // 下面的 throttleAi 照样卡着，不会因此变成不限次数的接口。
  if (row.submission.result !== JudgeStatus.COMPILE_ERROR) {
    const failed = await countFailedSubmissions(c.get("user")!.id, row.submission.problemId)
    if (failed < HINT_MIN_FAILURES)
      return failure(
        c,
        403,
        "hint-locked",
        `Hint unlocks after ${HINT_MIN_FAILURES} failed submissions`,
      )
  }
  const limited = await throttleAi(c)
  if (limited) return limited
  // 这次按第几级生成。等级记在「学生 × 题目」上，怎么算出来的见 services/hint-level.ts
  const { level, canEscalate } = await decideHintLevel(
    c.get("user")!.id,
    row.submission,
    parsed.data.more === true,
  )
  // 标准答案**只进诊断那一段**、出参只有枚举和行号；生成提示这一段看不到它。
  // 为什么这么拆、诊断怎么退回单段式，见 services/hint-diagnosis.ts 的文件头
  const startedAt = performance.now()
  const { diagnosis, error: diagnosisError } = await hintDiagnosis(row)
  const { system, prompt, version } = hintPrompt(row, diagnosis, level)
  const base = {
    submissionId: row.submission.id,
    startedAt,
    promptVersion: version,
    diagnosis,
    diagnosisError,
    level,
  }
  // 不是 streamChat：提示要整段生成、过滤通过才推给学生（设计 2.6），
  // 边流式边过滤做不到 —— 发现违规时内容已经在屏幕上了
  return streamWhole(
    async () => {
      const filtered = await generateFilteredHint({
        system,
        prompt,
        level,
        // 标程只用来核「有没有把它抄出来」，不进任何 prompt
        referenceCode: referenceAnswer(row)?.code ?? null,
      })
      // 落库失败就不带 id：前端据此不出评价按钮，提示本身照常显示
      const hintId = await recordHint(base, filtered.content, null, filtered)
      return {
        content: filtered.content,
        extra: { hintId, level, canEscalate } satisfies AiHintDone,
      }
    },
    {
      onError: async (message) => {
        await recordHint(base, "", message)
      },
    },
  )
})

aiRoutes.post("/ai/hint/:id/feedback", requireAuth, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = await readJson(c, aiHintFeedbackRequestSchema)
  if (!id || !parsed.success) return failure(c, 400, "invalid-request", "helpful is required")
  // 只能评自己的提示：顺着 submission 核对是不是本人。别人的和不存在的一样回 404，
  // 不透露那个 id 上有没有东西
  const [updated] = await db
    .update(schema.aiHint)
    .set({
      helpful: parsed.data.helpful,
      feedbackTime: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.aiHint.id, id),
        inArray(
          schema.aiHint.submissionId,
          db
            .select({ id: schema.submission.id })
            .from(schema.submission)
            .where(eq(schema.submission.userId, c.get("user")!.id)),
        ),
      ),
    )
    .returning({ id: schema.aiHint.id })
  if (!updated) return failure(c, 404, "hint-not-found", "Hint not found")
  return success(c, null)
})

aiRoutes.post("/ai/class-analysis", requireAuth, async (c) => {
  if (!isTeacherOrAbove(c.get("user")))
    return failure(c, 403, "permission-denied", "Permission denied")
  const parsed = await parseBody(c, classAnalysisRequestSchema, "Class data is required")
  if (!parsed.success) return parsed.response
  const limited = await throttleAi(c)
  if (limited) return limited
  return streamChat(
    "你是编程教育数据分析专家。根据班级 OJ 数据，从整体水平、参与积极性、均衡性、梯队和改进建议五方面输出中文 Markdown 报告。",
    JSON.stringify(parsed.data.comparison),
  )
})

aiRoutes.post("/ai/class-pk-analysis", requireAuth, async (c) => {
  if (!isTeacherOrAbove(c.get("user")))
    return failure(c, 403, "permission-denied", "Permission denied")
  const parsed = await parseBody(
    c,
    classPkAnalysisRequestSchema,
    "At least two classes are required",
  )
  if (!parsed.success) return parsed.response
  const limited = await throttleAi(c)
  if (limited) return limited
  return streamChat(
    "你是编程教育数据分析专家。根据多个班级 OJ 对比数据，从排名、参与度、典型学生水平、均衡性、梯队、提交质量和教学建议七方面输出中文 Markdown 报告。",
    `${parsed.data.timeRangeLabel}\n${JSON.stringify(parsed.data.comparisons)}`,
  )
})
