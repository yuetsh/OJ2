import {
  adminAiReportListSchema,
  adminAiReportListItemSchema,
  adminAiReportSchema,
  toggleAiReportPinResponseSchema,
} from "@oj2/contract"
import { and, count, desc, eq, ilike } from "drizzle-orm"
import { Hono } from "hono"

import { requireTeacher, type AppEnv } from "../../auth/middleware"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { queryInteger } from "../helpers"

export const adminAiRoutes = new Hono<AppEnv>()

/** 对齐旧 AIAnalysisListSerializer.get_analysis_excerpt：压掉空白后截 120 字，超出加省略号 */
function excerpt(analysis: string | null) {
  if (!analysis) return ""
  const text = analysis.split(/\s+/).filter(Boolean).join(" ")
  return text.length <= 120 ? text : `${text.slice(0, 120)}…`
}

function listItem(row: { id: number; username: string; createTime: string; analysis: string; isPinned: boolean }) {
  return adminAiReportListItemSchema.parse({
    id: row.id,
    username: row.username,
    createTime: row.createTime,
    analysisExcerpt: excerpt(row.analysis),
    isPinned: row.isPinned,
  })
}

const listColumns = {
  id: schema.aiAnalysis.id,
  username: schema.user.username,
  createTime: schema.aiAnalysis.createTime,
  analysis: schema.aiAnalysis.analysis,
  isPinned: schema.aiAnalysis.isPinned,
}

adminAiRoutes.get("/ai/reports", requireTeacher, async (c) => {
  const username = c.req.query("username")?.trim()
  const where = username ? ilike(schema.user.username, `%${username}%`) : undefined

  // 置顶列表不分页：它是「每个学生最新钉住的那份」，数量等于学生数，前端一次性拿走。
  // 但**形状必须和分页那支一样**：同一个 URL 返回两种形状，调用方没法照着一个类型写。
  // 这里原来返回裸数组，前端 getPinnedAIReports 声明的是 AdminAiReportList、
  // 读的是 res.results，于是拿到 undefined，`pinnedReports.length` 在渲染时抛
  // 「Cannot read properties of undefined」——空库也照抛，这个页面每次打开都白屏。
  if (c.req.query("pinnedOnly") === "true") {
    const rows = await db.select(listColumns).from(schema.aiAnalysis)
      .innerJoin(schema.user, eq(schema.aiAnalysis.userId, schema.user.id))
      .where(and(eq(schema.aiAnalysis.isPinned, true), where))
      .orderBy(desc(schema.aiAnalysis.createTime))
    return success(c, adminAiReportListSchema.parse({
      results: rows.map(listItem),
      total: rows.length,
    }))
  }

  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.aiAnalysis)
      .innerJoin(schema.user, eq(schema.aiAnalysis.userId, schema.user.id)).where(where),
    db.select(listColumns).from(schema.aiAnalysis)
      .innerJoin(schema.user, eq(schema.aiAnalysis.userId, schema.user.id)).where(where)
      .orderBy(desc(schema.aiAnalysis.createTime)).limit(limit).offset(offset),
  ])
  return success(c, adminAiReportListSchema.parse({
    results: rows.map(listItem),
    total: totalRows[0]?.value ?? 0,
  }))
})

adminAiRoutes.get("/ai/reports/:id", requireTeacher, async (c) => {
  const [row] = await db.select({
    id: schema.aiAnalysis.id,
    username: schema.user.username,
    className: schema.user.className,
    createTime: schema.aiAnalysis.createTime,
    analysis: schema.aiAnalysis.analysis,
  }).from(schema.aiAnalysis)
    .innerJoin(schema.user, eq(schema.aiAnalysis.userId, schema.user.id))
    .where(eq(schema.aiAnalysis.id, queryInteger(c.req.param("id"), 0, { min: 1 }))).limit(1)
  if (!row) return failure(c, 404, "report-not-found", "AIAnalysis not found")
  // data / systemPrompt / userPrompt 一律不下发：里面是喂给模型的原始学情数据与提示词
  return success(c, adminAiReportSchema.parse(row))
})

adminAiRoutes.post("/ai/reports/:id/pin", requireTeacher, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [report] = await db.select({ id: schema.aiAnalysis.id, userId: schema.aiAnalysis.userId, isPinned: schema.aiAnalysis.isPinned })
    .from(schema.aiAnalysis).where(eq(schema.aiAnalysis.id, id)).limit(1)
  if (!report) return failure(c, 404, "report-not-found", "AIAnalysis not found")

  // 切换语义，与旧后端一致：已置顶则取消；未置顶则先把该学生其它置顶清掉，保证每人至多一份
  const next = !report.isPinned
  await db.transaction(async (tx) => {
    if (next) {
      await tx.update(schema.aiAnalysis).set({ isPinned: false })
        .where(and(eq(schema.aiAnalysis.userId, report.userId), eq(schema.aiAnalysis.isPinned, true)))
    }
    await tx.update(schema.aiAnalysis).set({ isPinned: next }).where(eq(schema.aiAnalysis.id, id))
  })
  return success(c, toggleAiReportPinResponseSchema.parse({ isPinned: next }))
})
