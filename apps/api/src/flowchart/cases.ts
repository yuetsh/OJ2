import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { config } from "../config"
import type { schema } from "../db"
import { asRecord } from "../routes/helpers"
import { readInfo } from "../services/test-case"

/** 拿来在图上走一遍的一组数据 */
export interface FlowchartCase {
  name: string
  input: string
  expected: string
}

/** 例子之外再从测试数据里挑几组：例子常常覆盖不全（蜜橘分拣的五个例子没有「黄 + 有瑕疵」） */
const MAX_TESTS = 3
/** 一共最多走这么多组，再多 AI 就慢了、也更容易走错 */
const MAX_CASES = 8
/** 一组数据太长的不拿：流程图题都是几行输入，长的多半是批量数据，走不动 */
const MAX_TEXT = 300

function clean(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/\s+$/, "")
}

/**
 * 这道题拿哪几组数据来走：题目的例子全拿（学生本来就看得到），再补几组测试数据里和例子
 * 不一样的。测试数据的输入和应该输出会出现在结果页签里 —— 流程图题都是几行输入的小题，
 * 学生看到一两组不构成泄露，而「这一组走错了」比「逻辑正确性 25 / 40」有用得多。
 */
export async function flowchartCases(
  problem: typeof schema.problem.$inferSelect,
): Promise<FlowchartCase[]> {
  const cases: FlowchartCase[] = []
  const seen = new Set<string>()
  const samples = Array.isArray(problem.samples) ? problem.samples : []
  for (const raw of samples) {
    const item = asRecord(raw)
    if (typeof item.input !== "string" || typeof item.output !== "string") continue
    const input = clean(item.input)
    const expected = clean(item.output)
    if (input.length > MAX_TEXT || expected.length > MAX_TEXT) continue
    seen.add(input)
    cases.push({ name: `例子 ${cases.length + 1}`, input, expected })
    if (cases.length >= MAX_CASES) return cases
  }

  // 测试数据只有服务器上有；本机、或者题目没传测试点时就只用例子
  const info = await readInfo(problem.testCaseId)
  if (!info || info.sql) return cases
  const entries = Object.entries(info.test_cases ?? {}).sort(([a], [b]) => Number(a) - Number(b))
  let tests = 0
  for (const [, entry] of entries) {
    if (tests >= MAX_TESTS || cases.length >= MAX_CASES) break
    if (!entry.input_name || !entry.output_name) continue
    if (entry.input_size > MAX_TEXT || entry.output_size > MAX_TEXT) continue
    try {
      const directory = resolve(config.testCaseDirectory, problem.testCaseId)
      const input = clean(await readFile(resolve(directory, entry.input_name), "utf8"))
      const expected = clean(await readFile(resolve(directory, entry.output_name), "utf8"))
      if (!input || seen.has(input)) continue
      seen.add(input)
      tests++
      cases.push({ name: `测试 ${cases.length + 1}`, input, expected })
    } catch {
      continue
    }
  }
  return cases
}
