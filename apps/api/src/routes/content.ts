import {
  announcementListItemSchema,
  announcementListSchema,
  announcementSchema,
  createMessageRequestSchema,
  exerciseSchema,
  messageListSchema,
  messageSchema,
  reactionKeySchema,
  reactionStateSchema,
  setReactionRequestSchema,
  embeddedSubmissionSchema,
  exerciseAttemptRequestSchema,
  tutorialProgressPingSchema,
  tutorialProgressSchema,
  tutorialSchema,
  tutorialSummarySchema,
} from "@oj2/contract"
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, requireSuperAdmin, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { objectValue, queryInteger, sampleUser } from "./helpers"

export const contentRoutes = new Hono<AppEnv>()

contentRoutes.get("/announcements", async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.announcement).where(eq(schema.announcement.visible, true)),
    db.select({ announcement: schema.announcement, user: schema.user, realName: schema.userProfile.realName })
      .from(schema.announcement).innerJoin(schema.user, eq(schema.announcement.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(eq(schema.announcement.visible, true))
      .orderBy(desc(schema.announcement.top), desc(schema.announcement.createTime)).limit(limit).offset(offset),
  ])
  return success(c, announcementListSchema.parse({
    results: rows.map(({ announcement, user, realName }) => announcementListItemSchema.parse({
      id: announcement.id,
      title: announcement.title,
      tag: announcement.tag,
      top: announcement.top,
      createdBy: sampleUser(user, realName),
      createTime: announcement.createTime,
      lastUpdateTime: announcement.lastUpdateTime,
    })),
    total: totalRows[0]?.value ?? 0,
  }))
})

contentRoutes.get("/announcements/:id", async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [row] = await db.select({ announcement: schema.announcement, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.announcement).innerJoin(schema.user, eq(schema.announcement.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(and(eq(schema.announcement.id, id), eq(schema.announcement.visible, true))).limit(1)
  if (!row) return failure(c, 404, "announcement-not-found", "Announcement does not exist")
  return success(c, announcementSchema.parse({
    id: row.announcement.id,
    title: row.announcement.title,
    tag: row.announcement.tag,
    content: row.announcement.content,
    top: row.announcement.top,
    createdBy: sampleUser(row.user, row.realName),
    createTime: row.announcement.createTime,
    lastUpdateTime: row.announcement.lastUpdateTime,
  }))
})

contentRoutes.get("/messages", requireAuth, async (c) => {
  const user = c.get("user")!
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.message).where(eq(schema.message.recipientId, user.id)),
    db.select({ message: schema.message, sender: schema.user, realName: schema.userProfile.realName, submission: schema.submission, displayId: schema.problem.displayId })
      .from(schema.message).innerJoin(schema.user, eq(schema.message.senderId, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .innerJoin(schema.submission, eq(schema.message.submissionId, schema.submission.id))
      .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
      .where(eq(schema.message.recipientId, user.id)).orderBy(desc(schema.message.createTime)).limit(limit).offset(offset),
  ])
  return success(c, messageListSchema.parse({
    results: rows.map(({ message, sender, realName, submission, displayId }) => messageSchema.parse({
      id: message.id,
      sender: sampleUser(sender, realName),
      createTime: message.createTime,
      message: message.message,
      submission: embeddedSubmissionSchema.parse({
        id: submission.id,
        createTime: submission.createTime,
        userId: submission.userId,
        username: submission.username,
        code: submission.code,
        result: submission.result,
        // info / ip / contestId 三个字段不在 embeddedSubmissionSchema 里，故不传 ——
        // 对齐旧后端 SubmissionSafeModelSerializer 的 exclude，这三个键不出现在响应中
        language: submission.language,
        shared: submission.shared,
        statisticInfo: objectValue(submission.statisticInfo),
        // 展示用题号而非数字主键，站内信页面拿它拼 /problem/<题号>
        problem: displayId,
        showLink: true,
        canUnshare: false,
      }),
    })),
    total: totalRows[0]?.value ?? 0,
  }))
})

/**
 * 发站内信。**目前没有任何前端在调用它** —— 后台那个页面
 * （apps/web/src/admin/communication/messages.vue）两代前端都只是一句
 * 「未完待续」的占位，ojnext 里定义过一个 createMessage 但同样零调用，
 * 已在前端删掉。端点本身是完整实现的，要接 UI 从这里开始。
 */
contentRoutes.post("/messages", requireSuperAdmin, async (c) => {
  const user = c.get("user")!
  const parsed = createMessageRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid message payload")
  if (parsed.data.recipientId === user.id) return failure(c, 400, "invalid-recipient", "Can not send a message to yourself")
  const [[recipient], [submission]] = await Promise.all([
    db.select({ id: schema.user.id }).from(schema.user).where(and(eq(schema.user.id, parsed.data.recipientId), eq(schema.user.isDisabled, false))).limit(1),
    db.select({ id: schema.submission.id }).from(schema.submission).where(eq(schema.submission.id, parsed.data.submissionId)).limit(1),
  ])
  if (!recipient) return failure(c, 404, "user-not-found", "User does not exist")
  if (!submission) return failure(c, 404, "submission-not-found", "Submission does not exist")
  await db.insert(schema.message).values({
    message: parsed.data.message,
    createTime: new Date().toISOString(),
    recipientId: recipient.id,
    senderId: user.id,
    submissionId: submission.id,
  })
  return success(c, null, 201)
})

async function reactionState(problemId: number, userId: number) {
  const [mine] = await db.select({ type: schema.reaction.type }).from(schema.reaction)
    .where(and(eq(schema.reaction.problemId, problemId), eq(schema.reaction.userId, userId))).limit(1)
  if (!mine) return reactionStateSchema.parse({ mine: null, counts: null })
  const rows = await db.select({ type: schema.reaction.type, value: count() }).from(schema.reaction)
    .where(eq(schema.reaction.problemId, problemId)).groupBy(schema.reaction.type)
  const counts = Object.fromEntries(reactionKeySchema.options.map((key) => [key, 0]))
  for (const row of rows) {
    const key = reactionKeySchema.safeParse(row.type)
    if (key.success) counts[key.data] = row.value
  }
  return reactionStateSchema.parse({ mine: mine.type, counts })
}

contentRoutes.get("/problems/:id/reaction", requireAuth, async (c) => {
  const problemId = queryInteger(c.req.param("id"), 0, { min: 1 })
  return success(c, await reactionState(problemId, c.get("user")!.id))
})

contentRoutes.post("/problems/:id/reaction", requireAuth, async (c) => {
  const problemId = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = setReactionRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid reaction")
  const user = c.get("user")!
  const [[problem], [solved]] = await Promise.all([
    db.select({ id: schema.problem.id }).from(schema.problem).where(and(eq(schema.problem.id, problemId), eq(schema.problem.visible, true))).limit(1),
    db.select({ id: schema.submission.id }).from(schema.submission).where(and(
      eq(schema.submission.userId, user.id), eq(schema.submission.problemId, problemId),
      inArray(schema.submission.result, [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]),
    )).limit(1),
  ])
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!solved) return failure(c, 403, "accepted-submission-required", "An accepted submission is required")
  await db.insert(schema.reaction).values({
    problemId,
    userId: user.id,
    type: parsed.data.type,
    createTime: new Date().toISOString(),
  }).onConflictDoNothing({ target: [schema.reaction.problemId, schema.reaction.userId] })
  return success(c, await reactionState(problemId, user.id))
})

contentRoutes.get("/tutorials", async (c) => {
  const type = c.req.query("type") === "c" ? "c" : "python"
  const rows = await db.select({ id: schema.tutorial.id, title: schema.tutorial.title }).from(schema.tutorial)
    .where(and(eq(schema.tutorial.isPublic, true), eq(schema.tutorial.type, type))).orderBy(asc(schema.tutorial.order))
  return success(c, rows.map((row) => tutorialSummarySchema.parse(row)))
})

contentRoutes.get("/tutorials/:id", async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [row] = await db.select({ tutorial: schema.tutorial, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.tutorial).innerJoin(schema.user, eq(schema.tutorial.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(and(eq(schema.tutorial.id, id), eq(schema.tutorial.isPublic, true))).limit(1)
  if (!row) return failure(c, 404, "tutorial-not-found", "Tutorial does not exist")
  return success(c, tutorialSchema.parse({
    id: row.tutorial.id,
    title: row.tutorial.title,
    content: row.tutorial.content,
    code: row.tutorial.code,
    isPublic: row.tutorial.isPublic,
    order: row.tutorial.order,
    type: row.tutorial.type,
    createdBy: sampleUser(row.user, row.realName),
    createdAt: row.tutorial.createdAt,
    updatedAt: row.tutorial.updatedAt,
  }))
})

// ---------------------------------------------------------------- 自学留痕

/**
 * 学生自己的自学进度，给学习页的目录打勾用。
 *
 * 路径特意不放在 `/tutorials` 下：Hono 按**注册顺序**匹配（不是静态优先），
 * `/tutorials/:id` 就在上面几行，`/tutorials/progress` 会被它整个吃掉，而且不报错
 * ——`queryInteger("progress")` 回落成 0，学生只会看到一个「教程不存在」。
 */
contentRoutes.get("/learn/progress", requireAuth, async (c) => {
  const user = c.get("user")!
  const type = c.req.query("type") === "c" ? "c" : "python"
  const visible = and(eq(schema.tutorial.type, type), eq(schema.tutorial.isPublic, true))

  // 从 tutorial 打底 left join 进度，而不是反过来：没读过的课也要有一行零，
  // 否则目录里「练习 0/5」和「这课没有练习」在前端分不出来
  const [rows, exerciseRows] = await Promise.all([
    db.select({
      tutorialId: schema.tutorial.id,
      viewCount: schema.tutorialProgress.viewCount,
      totalSeconds: schema.tutorialProgress.totalSeconds,
      firstViewedAt: schema.tutorialProgress.firstViewedAt,
      lastViewedAt: schema.tutorialProgress.lastViewedAt,
    }).from(schema.tutorial)
      .leftJoin(schema.tutorialProgress, and(
        eq(schema.tutorialProgress.tutorialId, schema.tutorial.id),
        eq(schema.tutorialProgress.userId, user.id),
      ))
      .where(visible)
      .orderBy(asc(schema.tutorial.order)),
    db.select({
      tutorialId: schema.exercise.tutorialId,
      total: count(),
      solved: sql<number>`count(*) filter (where ${schema.exerciseAttempt.solved})`.mapWith(Number),
    }).from(schema.exercise)
      .innerJoin(schema.tutorial, eq(schema.tutorial.id, schema.exercise.tutorialId))
      .leftJoin(schema.exerciseAttempt, and(
        eq(schema.exerciseAttempt.exerciseId, schema.exercise.id),
        eq(schema.exerciseAttempt.userId, user.id),
      ))
      .where(visible)
      .groupBy(schema.exercise.tutorialId),
  ])
  const exercises = new Map(exerciseRows.map((row) => [row.tutorialId, row]))

  return success(c, rows.map((row) => tutorialProgressSchema.parse({
    tutorialId: row.tutorialId,
    viewCount: row.viewCount ?? 0,
    totalSeconds: row.totalSeconds ?? 0,
    firstViewedAt: row.firstViewedAt,
    lastViewedAt: row.lastViewedAt,
    exerciseTotal: exercises.get(row.tutorialId)?.total ?? 0,
    exerciseSolved: exercises.get(row.tutorialId)?.solved ?? 0,
  })))
})

/**
 * 上报一次自学留痕。`opened` 为真表示「刚进这一课」，计一次打开；
 * 否则只是心跳补时长，见 apps/web/src/oj/learn/composables/useLearnTrace.ts。
 *
 * 未登录一律 401 而不是静默丢弃 —— 教程本身保持免登录可读，前端只在登录后才调它，
 * 真收到匿名请求说明前端判断错了，得让它响。
 */
contentRoutes.post("/tutorials/:id/progress", requireAuth, async (c) => {
  const user = c.get("user")!
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = tutorialProgressPingSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid progress payload")
  const [tutorial] = await db.select({ id: schema.tutorial.id }).from(schema.tutorial)
    .where(and(eq(schema.tutorial.id, id), eq(schema.tutorial.isPublic, true))).limit(1)
  if (!tutorial) return failure(c, 404, "tutorial-not-found", "Tutorial does not exist")

  const now = new Date().toISOString()
  const { seconds, opened } = parsed.data
  await db.insert(schema.tutorialProgress).values({
    userId: user.id,
    tutorialId: id,
    viewCount: opened ? 1 : 0,
    totalSeconds: seconds,
    firstViewedAt: now,
    lastViewedAt: now,
  }).onConflictDoUpdate({
    target: [schema.tutorialProgress.userId, schema.tutorialProgress.tutorialId],
    set: {
      // 累加在库里做，不是「读出来加一下再写回去」：同一个学生开两个标签页
      // 同时上报时，读改写会互相覆盖，时长凭空少掉一半
      viewCount: sql`${schema.tutorialProgress.viewCount} + ${opened ? 1 : 0}`,
      totalSeconds: sql`${schema.tutorialProgress.totalSeconds} + ${seconds}`,
      lastViewedAt: now,
    },
  })
  return success(c, null)
})

/**
 * 上报一次练一练的作答。
 *
 * 对错是**前端判的** —— 练一练的答案本来就随题面一起下发给浏览器（见
 * `/tutorials/:id/exercises`），后端再判一遍也挡不住任何人，只是重复实现七套判题。
 * 所以这里存的是「学生自己说他做对了」，作为教学观察够用，**不能当考试成绩**。
 *
 * 做对之后的重复提交只更新时间，不再累加 —— 学生做对后再点几下提交，
 * 不该把「他试了几次」这个数字变大。
 */
contentRoutes.post("/exercises/:id/attempts", requireAuth, async (c) => {
  const user = c.get("user")!
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = exerciseAttemptRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "Invalid attempt payload")
  // 练习跟着教程走：教程没公开，它底下的练习也不该能上报
  const [exercise] = await db.select({ id: schema.exercise.id }).from(schema.exercise)
    .innerJoin(schema.tutorial, eq(schema.tutorial.id, schema.exercise.tutorialId))
    .where(and(eq(schema.exercise.id, id), eq(schema.tutorial.isPublic, true))).limit(1)
  if (!exercise) return failure(c, 404, "exercise-not-found", "Exercise does not exist")

  const now = new Date().toISOString()
  const { correct } = parsed.data
  const answer = correct ? null : (parsed.data.answer ?? null)
  await db.insert(schema.exerciseAttempt).values({
    userId: user.id,
    exerciseId: id,
    attempts: 1,
    wrongAttempts: correct ? 0 : 1,
    solved: correct,
    attemptsToSolve: correct ? 1 : null,
    lastWrongAnswer: answer,
    firstAttemptAt: now,
    lastAttemptAt: now,
    solvedAt: correct ? now : null,
  }).onConflictDoUpdate({
    target: [schema.exerciseAttempt.userId, schema.exerciseAttempt.exerciseId],
    set: {
      // 一律在库里算，不读出来改了再写回去：两个标签页同时提交会互相覆盖。
      //
      // 每一列都先看 `solved`：做对之后这一行就冻住了，只有 lastAttemptAt 还动。
      // 不冻的话，学生做对后随手再点几下提交，「他试了几次才做对」就被改花了。
      attempts: sql`${schema.exerciseAttempt.attempts} + case when ${schema.exerciseAttempt.solved} then 0 else 1 end`,
      wrongAttempts: sql`${schema.exerciseAttempt.wrongAttempts} + case when ${schema.exerciseAttempt.solved} or ${correct} then 0 else 1 end`,
      solved: sql`${schema.exerciseAttempt.solved} or ${correct}`,
      attemptsToSolve: sql`case
        when ${schema.exerciseAttempt.solved} then ${schema.exerciseAttempt.attemptsToSolve}
        when ${correct} then ${schema.exerciseAttempt.attempts} + 1
        else null end`,
      solvedAt: sql`case
        when ${schema.exerciseAttempt.solved} then ${schema.exerciseAttempt.solvedAt}
        when ${correct} then ${now}::timestamptz
        else null end`,
      lastWrongAnswer: sql`case
        when ${schema.exerciseAttempt.solved} or ${correct} then ${schema.exerciseAttempt.lastWrongAnswer}
        else ${answer} end`,
      lastAttemptAt: now,
    },
  })
  return success(c, null)
})

contentRoutes.get("/tutorials/:id/exercises", async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [tutorial] = await db.select({ id: schema.tutorial.id }).from(schema.tutorial)
    .where(and(eq(schema.tutorial.id, id), eq(schema.tutorial.isPublic, true))).limit(1)
  if (!tutorial) return failure(c, 404, "tutorial-not-found", "Tutorial does not exist")
  const rows = await db.select().from(schema.exercise).where(eq(schema.exercise.tutorialId, id)).orderBy(asc(schema.exercise.order))
  return success(c, rows.map((row) => exerciseSchema.parse({ id: row.id, type: row.type, data: objectValue(row.data), order: row.order })))
})
