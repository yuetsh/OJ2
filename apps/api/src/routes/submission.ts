import { randomBytes } from "node:crypto"

import {
  createSubmissionRequestSchema,
  createSubmissionResponseSchema,
  submissionDetailSchema,
} from "@oj2/contract"
import { and, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { judgeQueue } from "../queue"

export const submissionRoutes = new Hono<AppEnv>()

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

submissionRoutes.use("/submissions", requireAuth)
submissionRoutes.use("/submissions/*", requireAuth)

submissionRoutes.post("/submissions", async (c) => {
  const parsed = createSubmissionRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  )
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", "Invalid submission payload")
  }
  if (parsed.data.contestId) {
    return failure(
      c,
      400,
      "contest-not-supported",
      "Contest submissions are not part of the Phase 2 slice",
    )
  }

  const [problem] = await db
    .select({
      id: schema.problem.id,
      languages: schema.problem.languages,
    })
    .from(schema.problem)
    .where(
      and(
        eq(schema.problem.id, parsed.data.problemId),
        eq(schema.problem.visible, true),
        isNull(schema.problem.contestId),
      ),
    )
    .limit(1)

  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!stringArray(problem.languages).includes(parsed.data.language)) {
    return failure(
      c,
      400,
      "language-not-allowed",
      `${parsed.data.language} is not allowed in the problem`,
    )
  }

  const user = c.get("user")!
  const submissionId = randomBytes(16).toString("hex")
  const createTime = new Date().toISOString()
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  const ip = forwarded || c.req.header("x-real-ip") || null

  await db.insert(schema.submission).values({
    id: submissionId,
    problemId: problem.id,
    createTime,
    userId: user.id,
    username: user.username,
    code: parsed.data.code,
    result: JudgeStatus.PENDING,
    info: {},
    language: parsed.data.language,
    shared: false,
    statisticInfo: {},
    ip,
    contestId: null,
  })

  try {
    await judgeQueue.add(
      "judge",
      { submissionId, problemId: problem.id },
      { jobId: submissionId },
    )
  } catch (error) {
    await db
      .update(schema.submission)
      .set({ result: JudgeStatus.SYSTEM_ERROR })
      .where(eq(schema.submission.id, submissionId))
    console.error("Failed to enqueue submission", error)
    return failure(c, 502, "queue-unavailable", "Judge queue is unavailable")
  }

  return success(
    c,
    createSubmissionResponseSchema.parse({ submissionId }),
    201,
  )
})

submissionRoutes.get("/submissions/:id", async (c) => {
  const user = c.get("user")!
  const [row] = await db
    .select()
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.id, c.req.param("id")),
        eq(schema.submission.userId, user.id),
      ),
    )
    .limit(1)

  if (!row) {
    return failure(c, 404, "submission-not-found", "Submission does not exist")
  }

  const data = submissionDetailSchema.parse({
    id: row.id,
    createTime: row.createTime,
    userId: row.userId,
    username: row.username,
    code: row.code,
    result: row.result,
    info: row.info,
    language: row.language,
    shared: row.shared,
    statisticInfo: objectValue(row.statisticInfo),
    ip: row.ip,
    contestId: row.contestId,
    problemId: row.problemId,
    showLink: true,
    canUnshare: true,
  })

  return success(c, data)
})
