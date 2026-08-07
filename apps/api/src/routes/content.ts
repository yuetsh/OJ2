import {
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
  tutorialSchema,
  tutorialSummarySchema,
} from "@oj2/contract"
import { and, asc, count, desc, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { isSuperAdmin, objectValue, queryInteger, sampleUser } from "./helpers"

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
    results: rows.map(({ announcement, user, realName }) => announcementSchema.parse({
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

contentRoutes.post("/messages", requireAuth, async (c) => {
  const user = c.get("user")!
  if (!isSuperAdmin(user)) return failure(c, 403, "permission-denied", "Permission denied")
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

contentRoutes.get("/tutorials/:id/exercises", async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [tutorial] = await db.select({ id: schema.tutorial.id }).from(schema.tutorial)
    .where(and(eq(schema.tutorial.id, id), eq(schema.tutorial.isPublic, true))).limit(1)
  if (!tutorial) return failure(c, 404, "tutorial-not-found", "Tutorial does not exist")
  const rows = await db.select().from(schema.exercise).where(eq(schema.exercise.tutorialId, id)).orderBy(asc(schema.exercise.order))
  return success(c, rows.map((row) => exerciseSchema.parse({ id: row.id, type: row.type, data: objectValue(row.data), order: row.order })))
})
