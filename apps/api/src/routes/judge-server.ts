import { createHash, timingSafeEqual } from "node:crypto"

import { eq } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { z } from "zod"

import { config } from "../config"
import { db, schema } from "../db"
import { failure } from "../http"

const heartbeatSchema = z.object({
  hostname: z.string().min(1).max(128),
  judger_version: z.string().min(1).max(32),
  cpu_core: z.number().int().positive(),
  memory: z.number().min(0).max(100),
  cpu: z.number().min(0).max(100),
  action: z.literal("heartbeat"),
  service_url: z.string().min(1).max(256),
})

export const judgeServerRoutes = new Hono()

function tokenMatches(value: string | undefined) {
  if (!value) return false
  const expected = createHash("sha256")
    .update(config.judgeServerToken)
    .digest("hex")
  const actualBuffer = Buffer.from(value)
  const expectedBuffer = Buffer.from(expected)
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

async function heartbeat(c: Context) {
  if (!tokenMatches(c.req.header("X-Judge-Server-Token"))) {
    return failure(c, 403, "invalid-judge-token", "Invalid token")
  }

  const parsed = heartbeatSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-heartbeat", "Invalid heartbeat payload")
  }

  const now = new Date().toISOString()
  const [existing] = await db
    .select({ id: schema.judgeServer.id })
    .from(schema.judgeServer)
    .where(eq(schema.judgeServer.hostname, parsed.data.hostname))
    .limit(1)

  const common = {
    ip:
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      null,
    judgerVersion: parsed.data.judger_version,
    cpuCore: parsed.data.cpu_core,
    memoryUsage: parsed.data.memory,
    cpuUsage: parsed.data.cpu,
    lastHeartbeat: now,
    serviceUrl: parsed.data.service_url,
  }

  if (existing) {
    await db
      .update(schema.judgeServer)
      .set(common)
      .where(eq(schema.judgeServer.id, existing.id))
  } else {
    await db.insert(schema.judgeServer).values({
      ...common,
      hostname: parsed.data.hostname,
      createTime: now,
      taskNumber: 0,
      isDisabled: false,
    })
  }

  // JudgeServer 1.6.1 healthcheck still reads the legacy { error, data } envelope.
  return c.json({ error: null, data: null })
}

judgeServerRoutes.post("/judge-server/heartbeat", heartbeat)
judgeServerRoutes.post("/judge-server/heartbeat/", heartbeat)
