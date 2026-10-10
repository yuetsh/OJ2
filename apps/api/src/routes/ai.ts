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
} from "@oj2/contract"
import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { Hono, type Context } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { config } from "../config"
import { db, schema } from "../db"
import { JudgeStatus } from "../judge/status"
import { failure, parseBody, readJson, success } from "../http"
import { streamChat, streamWhole } from "../services/ai"
import { generateFilteredHint } from "../services/hint-filter"
import { buildDetail, buildDuration, listSolved } from "../services/learning-stats"
import { decideHintLevel } from "../services/hint-level"
import { hintDiagnosis, hintPrompt, referenceAnswer } from "../services/hint-diagnosis"
import { classDetail, classPk } from "../services/ranking"
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
  // 数字和抽屉里看到的是同一份（services/ranking.ts 的 classDetail），不再由前端整包传上来
  const detail = await classDetail(parsed.data.className, true)
  if (!detail.members) return failure(c, 404, "class-not-found", "这个班没有学生")
  return streamChat(
    [
      "你是编程课老师的助教。下面是一个班这学期在 OJ 上的做题数据（JSON，人名是用户名）。",
      "用中文 Markdown 写一份给老师看的简短分析，分四段，每段一两句，段首加粗：",
      "**整体**（人均和年级比、班级对抗第几）、**节奏**（每周人均的起伏，课上做还是课外也练）、",
      "**分化**（前后 10%、人最多的那一档同分）、**建议**（点名 care 里的同学，给下节课能直接做的事）。",
      "用大白话，不要出现四分位数、标准差、方差这类统计词，不要编数据里没有的数字。",
    ].join(""),
    JSON.stringify(detail),
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
  // 数字和页面上的是同一份（services/ranking.ts 的 classPk），不再由前端整包传上来
  const pk = await classPk([...new Set(parsed.data.classNames)], parsed.data.period, null)
  const label = (name: string) => `${name.slice(0, 2)}计算机${name.slice(2)}班`
  const facts = {
    时间段: parsed.data.period === "week" ? "这周" : "这学期",
    各班: pk.classes.map((item) => ({
      班级: label(item.className),
      人数: item.members,
      人均做对: item.perCapita,
      中间那位做对: item.median,
      做对过题的人: item.solvedMembers,
      一次就对百分比: item.firstPercent,
      同一批题里领先几道: item.lead,
      这学期每周人均新做对: item.weekly,
    })),
    同一批题: pk.problems.map((problem) => ({
      题目: problem.title,
      各班: problem.cells.map((cell, index) =>
        cell
          ? {
              班级: label(pk.classes[index]!.className),
              做对的人占全班百分比: cell.percent,
              一次就对百分比: cell.firstPercent,
              交过的人: cell.tried,
              最好: cell.best,
            }
          : { 班级: label(pk.classes[index]!.className), 没布置: true },
      ),
    })),
    只有一个班布置过的题数: pk.solo.length,
  }
  return streamChat(
    [
      "你是编程课老师的助教。下面是几个班在 OJ 上的对比数据（JSON）。各班进度不同、布置的题不一样，",
      "所以比较以「同一批题」（至少两个班都布置过的题）为主，人均做对只作参考。",
      "用中文 Markdown 写一份给老师看的简短分析，分三到四段，每段一两句，段首加粗：",
      "**整体**（人均和同一批题里各班领先几道，人均差距有多少是进度造成的）、",
      "**差得最多的题**（点题目名，哪个班明显低）、**一次就对**（哪个班更稳、哪个班靠多交几次）、",
      "**建议**（下节课能直接做的事）。用大白话，不要出现四分位数、标准差这类统计词，不要编数据里没有的数字。",
    ].join(""),
    JSON.stringify(facts),
  )
})
