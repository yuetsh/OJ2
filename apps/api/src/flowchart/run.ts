import { inflateSync } from "node:zlib"

import {
  flowChildren,
  isFlowchartPass,
  parseFlowDoc,
  type FlowchartCaseReport,
  type FlowchartCaseResult,
  type FlowchartUpdate,
  type FlowDoc,
  type FlowStep,
} from "@oj2/contract"
import { eq } from "drizzle-orm"

import { config } from "../config"
import { db, schema } from "../db"
import { publishFlowchartUpdate } from "../events"
import { asRecord } from "../routes/helpers"
import { completeChat } from "../services/ai"
import { plainText } from "../services/hint-diagnosis"
import { recordSolvedAndNotify } from "../services/problemset"
import { runTrial } from "../judge/trial"
import { flowchartCases, type FlowchartCase } from "./cases"
import { buildProgram, describeDoc, flowBoxes, judgeCase, TRANSLATE_PROMPT } from "./program"
import { gradeForCases, gradeForScore } from "./grade"
import type { FlowchartJobData } from "./job"

type Problem = typeof schema.problem.$inferSelect

interface Evaluation {
  score: number
  grade: string
  feedback: string
  suggestions: string
  criteria: Record<string, unknown>
}

/**
 * 走例子：把学生的图拼成程序（结构照图、每个框的字由 AI 翻成一句 Python），拿题目的例子和
 * 几组测试数据在判题机上跑，逐组比输出。拼法和比法见 program.ts。
 *
 * 原来是让 AI 按逻辑 40 / 完整 30 / 规范 20 / 清晰 10 打总分：同一张图交两次能差 35 分
 * （有一张 C 再交变 S），学生学会了原样连点 —— 22% 的提交和上一次一模一样；评语里还写
 * node_9 这种学生看不到的编号。现在对不对由程序跑出来的输出决定，和模型的心情无关。
 */
function translateInput(problem: Problem, doc: FlowDoc, cases: FlowchartCase[]) {
  const samples = cases.filter((item) => item.name.startsWith("例子")).slice(0, 3)
  return [
    `题目：${problem.title}`,
    `描述：${plainText(problem.description).slice(0, 1500)}`,
    `输入说明：${plainText(problem.inputDescription).slice(0, 400) || "无"}`,
    `输出说明：${plainText(problem.outputDescription).slice(0, 400) || "无"}`,
    ...samples.map((item) => `${item.name}的输入：\n${item.input}`),
    "",
    "<flowchart>",
    describeDoc(doc),
    "</flowchart>",
  ].join("\n")
}

/** 交上来的结构树（压缩过的）；2026-10 之前的 vue-flow 格式读不出来，给 null */
function flowDocOf(data: unknown): FlowDoc | null {
  const record = asRecord(data)
  if (typeof record.data !== "string") return null
  try {
    return parseFlowDoc(
      JSON.parse(inflateSync(Buffer.from(record.data, "base64")).toString("utf8")),
    )
  } catch {
    return null
  }
}

async function evaluateByRunning(
  problem: Problem,
  submission: typeof schema.flowchartSubmission.$inferSelect,
): Promise<Evaluation | null> {
  const doc = flowDocOf(submission.flowchartData)
  if (!doc) return null
  const cases = await flowchartCases(problem)
  if (!cases.length) return null

  const reply = asRecord(
    JSON.parse(
      await completeChat(TRANSLATE_PROMPT, translateInput(problem, doc, cases), { json: true }),
    ),
  )
  const boxes = asRecord(reply.boxes)
  const code: Record<string, string | null> = {}
  for (const [node, value] of Object.entries(boxes))
    code[node] = typeof value === "string" ? value : null
  const style = typeof reply.style === "string" ? reply.style.trim() : ""

  const { order, nodeOf } = flowBoxes(doc)
  const texts = new Map<string, string>([
    ["n0", "开始"],
    [`n${order.length - 1}`, "结束"],
  ])
  const walk = (steps: FlowStep[]) => {
    for (const step of steps) {
      texts.set(nodeOf(step), step.text.trim())
      for (const child of flowChildren(step)) walk(child)
    }
  }
  walk(doc.steps)

  const { source, nodeAtLine } = buildProgram(doc, code)
  const run = await runTrial({
    userId: submission.userId,
    language: "Python",
    source,
    code: source,
    prependLines: 0,
    timeLimit: 1000,
    memoryLimit: 256,
    cases: cases.map((item) => ({ input: item.input, output: item.expected })),
    fullOutput: true,
    // 后台评分，别和学生「运行例子」抢交互池的名额
    pool: "judge",
  })

  let results: FlowchartCaseResult[]
  if (run.status === "done") {
    results = cases.map((item, index) => judgeCase(item, run.cases[index] ?? null, texts))
  } else {
    // 整段程序没跑起来：AI 翻出来的某一句语法不对（多半是框里的字太含糊），或者输出停不下来
    const line = run.status === "compile-error" ? Number(run.message.match(/line (\d+)/)?.[1]) : NaN
    const node = Number.isFinite(line) ? nodeAtLine(line) : null
    const why =
      run.status === "compile-error"
        ? `「${(node && texts.get(node)) || "有一个框"}」这一步写得看不明白，换个说法写清楚`
        : "走不到结束：一直在循环里出不来。看看循环的条件，循环里有没有让条件变化的那一步"
    results = cases.map((item) => ({
      name: item.name,
      input: item.input,
      expected: item.expected,
      output: "",
      ok: false,
      path: [],
      wrongAt: node,
      why,
    }))
  }

  const passed = results.filter((row) => row.ok).length
  const grade = gradeForCases(passed, results.length, style !== "")
  const report: FlowchartCaseReport = { version: 2, passed, total: results.length, cases: results }
  return {
    // 分数只给统计和老的列表用：没全对时是走对的比例，全对时 A 90、S 100
    score: grade === "S" ? 100 : grade === "A" ? 90 : Math.round((passed / results.length) * 100),
    grade,
    feedback: "",
    suggestions: passed === results.length ? style : "",
    criteria: { ...report },
  }
}

/**
 * 老办法：按四项打总分。只剩两种情况用它 —— 题目一组例子、一组测试数据都拿不出来；
 * 或者交上来的不是结构树（2026-10 之前的画布、重新评分老提交）
 */
function evaluationPrompt(problem: Problem) {
  return `你是专业的编程教学助手，负责评估学生的 Mermaid 流程图。
评分：逻辑正确性40分、完整性30分、规范性20分、清晰度10分。
不要评价系统生成的节点ID。feedback不超过100字；suggestions最多3条且只针对真实问题。
返回纯 JSON：{"score":85,"grade":"A","feedback":"...","suggestions":"...","criteria_details":{"逻辑正确性":{"score":34,"max":40,"comment":"..."},"完整性":{"score":26,"max":30,"comment":"..."},"规范性":{"score":17,"max":20,"comment":"..."},"清晰度":{"score":8,"max":10,"comment":"..."}}}。
等级：S=90-100，A=80-89，B=70-79，C=0-69。
题目：${problem.title}\n${problem.description.slice(0, 2000)}`
}

const CRITERIA_MAX: Record<string, number> = { 逻辑正确性: 40, 完整性: 30, 规范性: 20, 清晰度: 10 }

/**
 * 四项明细收成 `{ 项名: { score, max, comment } }`，提交详情和统计都按这个形状读。
 * 原来 prompt 里只写了 `"criteria_details":{}`，模型有时直接给 `"逻辑正确性": 34`，
 * 存进去页面上四项全是「0 / 0」（2026-10 重新评分老提交时撞上的）。缺 max 的按满分表补
 */
function normalizeCriteria(raw: unknown) {
  return Object.fromEntries(
    Object.entries(asRecord(raw)).map(([key, value]) => {
      const item = asRecord(value)
      const score = typeof value === "number" ? value : Number(item.score)
      const max = Number(item.max)
      return [
        key,
        {
          score: Number.isFinite(score) ? score : 0,
          max: Number.isFinite(max) && max > 0 ? max : (CRITERIA_MAX[key] ?? 100),
          comment: typeof item.comment === "string" ? item.comment : "",
        },
      ]
    }),
  )
}

function parseEvaluation(value: string): Evaluation {
  const block = value.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]
  const json = block ?? value.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error("AI response did not contain JSON")
  const data = JSON.parse(json) as Record<string, unknown>
  if (typeof data.score !== "number" || Number.isNaN(data.score))
    throw new Error("AI response is missing score")
  const score = Math.max(0, Math.min(100, data.score))
  return {
    score,
    grade: gradeForScore(score),
    feedback: typeof data.feedback === "string" ? data.feedback : "",
    suggestions: typeof data.suggestions === "string" ? data.suggestions : "",
    criteria: normalizeCriteria(data.criteria_details),
  }
}

async function evaluate(
  problem: Problem,
  submission: typeof schema.flowchartSubmission.$inferSelect,
): Promise<Evaluation> {
  const byRunning = await evaluateByRunning(problem, submission)
  if (byRunning) return byRunning
  const reference = problem.mermaidCode
    ? `\n标准答案参考：\n${problem.mermaidCode}`
    : "\n此题没有标准流程图。"
  return parseEvaluation(
    await completeChat(
      evaluationPrompt(problem),
      `学生流程图：\n${submission.mermaidCode}${reference}\n设计提示：${problem.flowchartHint ?? "无"}`,
    ),
  )
}

export async function evaluateFlowchart(
  job: FlowchartJobData,
  { isFinalAttempt = true }: { isFinalAttempt?: boolean } = {},
) {
  const [row] = await db
    .select({ flowchart: schema.flowchartSubmission, problem: schema.problem })
    .from(schema.flowchartSubmission)
    .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
    .where(eq(schema.flowchartSubmission.id, job.submissionId))
    .limit(1)
  if (!row || ![0, 1].includes(row.flowchart.status)) return
  await db
    .update(schema.flowchartSubmission)
    .set({ status: 1 })
    .where(eq(schema.flowchartSubmission.id, row.flowchart.id))
  const started = performance.now()
  try {
    const result = await evaluate(row.problem, row.flowchart)
    await db
      .update(schema.flowchartSubmission)
      .set({
        status: 2,
        aiScore: result.score,
        aiGrade: result.grade,
        aiFeedback: result.feedback,
        aiSuggestions: result.suggestions,
        aiCriteriaDetails: result.criteria,
        aiProvider: config.aiProvider,
        aiModel: config.aiModel,
        processingTime: (performance.now() - started) / 1000,
        evaluationTime: new Date().toISOString(),
      })
      .where(eq(schema.flowchartSubmission.id, row.flowchart.id))
    // 画到 A / S 算这道题做完，记进所有已加入、且包含这道题的题单 —— 和判题那一路
    // 同一个口径（不看是从哪个入口交的）。放在推「评完了」之前：前端收到的时候进度已经
    // 落库，1.5 秒后跳回题单页看到的就是新数据。比赛题不进题单
    if (isFlowchartPass(result.grade) && row.problem.contestId === null) {
      await recordSolvedAndNotify(row.flowchart.userId, row.problem.id, new Date().toISOString())
    }
    await publishFlowchartUpdate(row.flowchart.userId, {
      type: "flowchart_evaluation_completed",
      submissionId: row.flowchart.id,
      score: result.score,
      grade: result.grade,
      feedback: result.feedback,
      suggestions: result.suggestions,
      criteriaDetails: result.criteria,
    } satisfies FlowchartUpdate)
  } catch (error) {
    // 原来这里把 error.message 原样推给学生、前端还直接 message.error 弹出来 ——
    // AI provider 的地址、内部报错就这么进了浏览器。真实原因留在服务端日志里，
    // 学生只需要知道「失败了，再试一次」；error 字段留空，前端有兜底文案。
    console.error(`Failed to evaluate flowchart ${row.flowchart.id}`, error)
    // 只有最后一次尝试才落 FAILED。中间几次必须把状态留在 PROCESSING(1)：
    // 上面那道 `![0, 1].includes(status)` 的守卫会把状态为 3 的任务直接放行返回，
    // 一旦提前写成 3，队列配的 attempts: 3 就成了摆设 —— 后两次尝试进来什么都不做
    // 就算成功，AI 侧的偶发失败（限流、超时、网络抖动）永远等不到重试。
    if (!isFinalAttempt) throw error
    await db
      .update(schema.flowchartSubmission)
      .set({ status: 3 })
      .where(eq(schema.flowchartSubmission.id, row.flowchart.id))
    await publishFlowchartUpdate(row.flowchart.userId, {
      type: "flowchart_evaluation_failed",
      submissionId: row.flowchart.id,
    } satisfies FlowchartUpdate)
    throw error
  }
}
