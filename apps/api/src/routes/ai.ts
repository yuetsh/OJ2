import {
  aiAnalysisRequestSchema,
  aiHintFeedbackRequestSchema,
  aiHintRequestSchema,
  classAnalysisRequestSchema,
  classPkAnalysisRequestSchema,
  HINT_MIN_FAILURES,
  LEARNING_PERIOD_LABELS,
  learningPeriodSchema,
  type AiAnalysisRecord,
  type AiHintDone,
  type HintDiagnosis,
  type LearningItem,
  type LearningReport,
} from "@oj2/contract"
import { and, desc, eq, inArray, or, sql } from "drizzle-orm"
import { Hono, type Context } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { config } from "../config"
import { db, schema } from "../db"
import { JudgeStatus, judgeStatusName } from "../judge/status"
import { failure, parseBody, readJson, success } from "../http"
import { streamChat, streamWhole } from "../services/ai"
import { generateFilteredHint } from "../services/hint-filter"
import { buildReport } from "../services/learning-stats"
import { decideHintLevel } from "../services/hint-level"
import { hintDiagnosis, hintPrompt, referenceAnswer } from "../services/hint-diagnosis"
import { classDetail, classPk } from "../services/ranking"
import { consumeToken } from "../services/throttling"
import { dayNumber, localWeekday } from "../time"
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

aiRoutes.get("/ai/report", requireAuth, async (c) => {
  const period = learningPeriodSchema.safeParse(c.req.query("period") ?? "term")
  if (!period.success)
    return failure(c, 400, "invalid-period", "period must be week, month, term or all")
  const user = await targetUser(c)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  // 老师看别人时给出同班前后一个人，好在页面上 ‹ › 翻
  const viewingOther = user.id !== c.get("user")!.id
  return success(c, await buildReport(user, period.data, { neighbors: viewingOther }))
})

/**
 * 页面上「AI 帮你分析」那张卡要显示的小结：老师在后台钉住的那份优先（不分时间段），
 * 否则是这个时间段最近生成的一份。都没有就是 null，前端出「AI 帮我分析」按钮。
 */
aiRoutes.get("/ai/analysis/latest", requireAuth, async (c) => {
  const period = learningPeriodSchema.safeParse(c.req.query("period") ?? "term")
  if (!period.success)
    return failure(c, 400, "invalid-period", "period must be week, month, term or all")
  const user = await targetUser(c)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  const [row] = await db
    .select({ analysis: schema.aiAnalysis, username: schema.user.username })
    .from(schema.aiAnalysis)
    .innerJoin(schema.user, eq(schema.aiAnalysis.userId, schema.user.id))
    .where(
      and(
        eq(schema.aiAnalysis.userId, user.id),
        or(
          eq(schema.aiAnalysis.isPinned, true),
          sql`${schema.aiAnalysis.data}->>'period' = ${period.data}`,
        ),
      ),
    )
    .orderBy(desc(schema.aiAnalysis.isPinned), desc(schema.aiAnalysis.createTime))
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

const WEEKDAY = "日一二三四五六"

/**
 * 喂给模型的学情数据，全部翻成中文、带单位，和页面同一份（buildReport）。原来是
 * detail / duration 原样 JSON 进 prompt，模型读不懂裸编码：「错误类型 -1」（答案错误）
 * 被说成编译错误，`period 1` 原样出现在报告里，用户名 xuyue 被猜成了真名。
 *
 * 节奏按「每节课」给，不再按从现在往回推的一周一周切 —— 那样切出来的桶边界在半夜，
 * 标签写「9月23日起」其实是 24 日起，模型据此说「23 日那周一道没做」，而那天做对了两道。
 * 名字和班级不给，报告里一律称「你」。
 */
function analysisFacts(report: LearningReport) {
  const result = (item: LearningItem) =>
    item.status === "first"
      ? "一次就对"
      : item.status === "tries"
        ? `交了 ${item.attempts} 次才对`
        : item.status === "fail"
          ? `交了 ${item.attempts} 次还没做对`
          : "没交"
  const problem = (item: LearningItem) => ({ 题目: item.title, 结果: result(item) })
  const date = (day: string) => {
    const [, month, date] = day.split("-").map(Number)
    return `${month}月${date}日 周${WEEKDAY[localWeekday(dayNumber(day))]}`
  }
  // 两个超时码合成一种说法
  const errors = new Map<string, number>()
  for (const item of report.errors) {
    const name = judgeStatusName(item.result)
    errors.set(name, (errors.get(name) ?? 0) + item.count)
  }
  return {
    时间段: LEARNING_PERIOD_LABELS[report.period],
    做对的题数: report.solved,
    一次就对的题数: report.firstTry,
    提交次数: report.submissionCount,
    ...(report.classStats && {
      班上中间那位做对的题数: report.classStats.medianSolved,
      班上中间那位一次就对的百分比: report.classStats.medianFirstPercent,
    }),
    没通过的提交: [...errors].map(([结果, 次数]) => ({ 结果, 次数 })),
    做过的知识点: report.knowledge
      .filter((item) => item.tried)
      .map((item) => ({ 知识点: item.name, 做对几道: item.solved })),
    // 新的在前；「全部」可能有上百天，只给最近 30 天，够模型说节奏
    每天: report.days.slice(0, 30).map((day) => ({
      日期: date(day.day),
      ...(day.lesson.length && { 课上的题: day.lesson.map(problem) }),
      ...(day.own.length && { 自己练的题: day.own.map(problem) }),
    })),
  }
}

aiRoutes.post("/ai/analysis", requireAuth, async (c) => {
  const parsed = await parseBody(c, aiAnalysisRequestSchema, "period is required")
  if (!parsed.success) return parsed.response
  // 传 username 的鉴权走 targetUser：非教师传了也只会拿到自己
  const user = await targetUser(c, parsed.data.username)
  if (!user) return failure(c, 404, "user-not-found", "User not found")
  const limited = await throttleAi(c)
  if (limited) return limited
  // 学情数据一律服务端重算，客户端只说看谁、哪段时间
  const report = await buildReport(user, parsed.data.period, { neighbors: false })
  const system = [
    "你是中职学校的编程课老师，在给自己班上的一位学生写学习小结，学生会在网站上自己读到。",
    "下面是这位学生在判题网站上的做题数据（JSON）。页面上已经按天列出了每道题，不用把数字挨个复述一遍。",
    "用中文 Markdown 写，总共 300 字以内，分四段，每段一到三句，段首加粗：",
    "**这段时间**（做了多少、节奏怎么样，挑一两个最能说明问题的数字，节奏照「每天」里的说）、",
    "**做得好的**（点出具体题目名，挑一次就对的题；交了好几次才对的不算做得好）、",
    "**要注意的**（错得最多的是哪种，教一个具体的检查办法：答案错误就自己多想几组输入试，特别是最大最小的情况；",
    "编译失败、运行时错误就先读报错信息，找到它指出的那一行和错误名；运行超时就看循环能不能停下来；",
    "交了好几次才对、还没做对、课上没交的题点出名字）、",
    "**下一步**（一两件下节课就能做的事，比如把还没做对的题接着做完、把交了好几次才对的题重做一遍、在题目列表里按知识点找题练）。",
    "最后另起一段，只写一句鼓励的话，要和这位学生的数据挂钩，不要空口号。",
    "用「你」称呼学生，不要写名字。说大白话，不要英文和术语，不要「追」「对手」这类拿同学比的说法。",
    "只用数据里有的数字和题目名，不要编；数据里没有的方面就不写（比如错误次数没按题目分，就别说错在哪类题上）。",
    "不要表格、标题、代码块、字符画、分割线，不要 emoji。",
    "数据说明：「课上的题」是班上那天一起做的题，「没交」是班上做了、这位学生一次没交；「自己练的题」是课外自己找来做的。",
    "如果这段时间一道题都没做对，就简短说说看到的情况，鼓励下节课先把老师布置的题做出来。",
  ].join("")
  const prompt = JSON.stringify(analysisFacts(report))
  return streamChat(system, prompt, {
    onComplete: async (analysis) => {
      // 报告归被分析的那个人，不归发起请求的人 —— 教师后台的 pin 和学生侧的
      // GET /ai/analysis/latest 都是按 user_id 找报告的，记在教师名下学生就永远看不到
      await db.insert(schema.aiAnalysis).values({
        provider: config.aiProvider,
        model: config.aiModel,
        // period 是 /ai/analysis/latest 按时间段找回这份小结的依据
        data: { period: report.period, report },
        systemPrompt: system,
        userPrompt: prompt,
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
