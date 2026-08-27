import { flowchartUpdateSchema } from "@oj2/contract"
import { eq } from "drizzle-orm"

import { db, schema } from "../db"
import { publishFlowchartUpdate } from "../events"
import { completeChat } from "../services/ai"
import type { FlowchartJobData } from "./job"

function evaluationPrompt(problem: typeof schema.problem.$inferSelect) {
  return `你是专业的编程教学助手，负责评估学生的 Mermaid 流程图。
评分：逻辑正确性40分、完整性30分、规范性20分、清晰度10分。
不要评价系统生成的节点ID。feedback不超过100字；suggestions最多3条且只针对真实问题。
返回纯 JSON：{"score":85,"grade":"A","feedback":"...","suggestions":"...","criteria_details":{}}。
等级：S=90-100，A=80-89，B=70-79，C=0-69。
题目：${problem.title}\n${problem.description.slice(0, 2000)}`
}

function parseEvaluation(value: string) {
  const block = value.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]
  const json = block ?? value.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error("AI response did not contain JSON")
  const data = JSON.parse(json) as Record<string, unknown>
  if (typeof data.score !== "number" || typeof data.grade !== "string") throw new Error("AI response is missing score or grade")
  return {
    score: Math.max(0, Math.min(100, data.score)),
    grade: data.grade,
    feedback: typeof data.feedback === "string" ? data.feedback : "",
    suggestions: typeof data.suggestions === "string" ? data.suggestions : "",
    criteria: data.criteria_details && typeof data.criteria_details === "object" ? data.criteria_details : {},
  }
}

export async function evaluateFlowchart(job: FlowchartJobData) {
  const [row] = await db.select({ flowchart: schema.flowchartSubmission, problem: schema.problem }).from(schema.flowchartSubmission)
    .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
    .where(eq(schema.flowchartSubmission.id, job.submissionId)).limit(1)
  if (!row || ![0, 1].includes(row.flowchart.status)) return
  await db.update(schema.flowchartSubmission).set({ status: 1 }).where(eq(schema.flowchartSubmission.id, row.flowchart.id))
  const started = performance.now()
  try {
    const reference = row.problem.mermaidCode ? `\n标准答案参考：\n${row.problem.mermaidCode}` : "\n此题没有标准流程图。"
    const result = parseEvaluation(await completeChat(
      evaluationPrompt(row.problem),
      `学生流程图：\n${row.flowchart.mermaidCode}${reference}\n设计提示：${row.problem.flowchartHint ?? "无"}`,
    ))
    await db.update(schema.flowchartSubmission).set({
      status: 2,
      aiScore: result.score,
      aiGrade: result.grade,
      aiFeedback: result.feedback,
      aiSuggestions: result.suggestions,
      aiCriteriaDetails: result.criteria,
      aiProvider: "deepseek",
      aiModel: process.env.AI_MODEL ?? "deepseek-v4-flash",
      processingTime: (performance.now() - started) / 1000,
      evaluationTime: new Date().toISOString(),
    }).where(eq(schema.flowchartSubmission.id, row.flowchart.id))
    await publishFlowchartUpdate(row.flowchart.userId, flowchartUpdateSchema.parse({
      type: "flowchart_evaluation_completed",
      submissionId: row.flowchart.id,
      score: result.score,
      grade: result.grade,
      feedback: result.feedback,
      suggestions: result.suggestions,
      criteriaDetails: result.criteria,
    }))
  } catch (error) {
    // 原来这里把 error.message 原样推给学生、前端还直接 message.error 弹出来 ——
    // AI provider 的地址、内部报错就这么进了浏览器。真实原因留在服务端日志里，
    // 学生只需要知道「失败了，再试一次」；error 字段留空，前端有兜底文案。
    console.error(`Failed to evaluate flowchart ${row.flowchart.id}`, error)
    await db.update(schema.flowchartSubmission).set({ status: 3 }).where(eq(schema.flowchartSubmission.id, row.flowchart.id))
    await publishFlowchartUpdate(row.flowchart.userId, flowchartUpdateSchema.parse({
      type: "flowchart_evaluation_failed",
      submissionId: row.flowchart.id,
    }))
    throw error
  }
}
