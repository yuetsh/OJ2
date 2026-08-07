import { createHash } from "node:crypto"
import { mkdir, chmod, readdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { unzipSync, zipSync } from "fflate"

import { config } from "../config"

/**
 * 测试点压缩包的解析与落盘。对齐旧 `problem/views/admin.py:TestCaseZipProcessor`。
 *
 * 落盘格式必须与判题沙箱镜像的约定一致 —— 沙箱直接读挂载进去的目录：
 *   <test_case_id>/1.in  1.out  2.in  2.out ...  info
 * `info` 里 `test_cases` 的键是从 "1" 开始的字符串序号。
 */

/** 单个测试点文件上限。机房那台机器盘不大，一个失手的大文件能把判题一起拖挂 */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024
/** 解压后总大小上限，防 zip bomb */
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
/** 测试点数量上限 */
const MAX_CASES = 500

export class TestCaseError extends Error {}

export interface TestCaseEntry {
  stripped_output_md5: string
  input_size: number
  output_size: number
  input_name: string
  output_name: string
}

/** 等价于 Python 的 bytes.rstrip()：只剥尾部 ASCII 空白 */
function rstrip(buffer: Uint8Array) {
  const whitespace = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c])
  let end = buffer.length
  while (end > 0 && whitespace.has(buffer[end - 1]!)) end -= 1
  return buffer.subarray(0, end)
}

/** CRLF → LF，与旧后端 `content.replace(b"\r\n", b"\n")` 一致 */
function normalizeNewlines(buffer: Uint8Array) {
  const out = new Uint8Array(buffer.length)
  let length = 0
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) continue
    out[length] = buffer[i]!
    length += 1
  }
  return out.subarray(0, length)
}

/**
 * 从 1 开始找连续编号的测试点，遇到缺口就停。
 * 缺口之后的文件一律忽略 —— 与旧 `filter_name_list` 一致：编号断了说明打包出了问题，
 * 沉默地跳过一段比按乱序判题安全。
 */
function collectPairs(names: Set<string>) {
  const pairs: [string, string][] = []
  for (let index = 1; index <= MAX_CASES; index += 1) {
    const input = `${index}.in`
    const output = `${index}.out`
    if (!names.has(input) || !names.has(output)) break
    pairs.push([input, output])
  }
  return pairs
}

function collectSqlScripts(names: Set<string>) {
  const scripts: string[] = []
  for (let index = 1; index <= MAX_CASES; index += 1) {
    const name = `${index}.sql`
    if (!names.has(name)) break
    scripts.push(name)
  }
  return scripts
}

export interface ProcessedTestCase {
  testCaseId: string
  info: TestCaseEntry[]
}

export async function processTestCaseZip(
  archive: Uint8Array,
  options: { sql?: boolean } = {},
): Promise<ProcessedTestCase> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(archive)
  } catch {
    throw new TestCaseError("压缩包损坏或不是 zip 格式")
  }

  // 只按「精确文件名」取内容，不遍历压缩包里的条目 ——
  // 条目名一律不参与路径拼接，zip slip（`../../etc/passwd` 这类条目名）从设计上就进不来。
  const names = new Set(Object.keys(files).filter((name) => /^\d+\.(in|out|sql)$/.test(name)))

  const selected = options.sql ? collectSqlScripts(names) : collectPairs(names).flat()
  if (selected.length === 0) throw new TestCaseError("压缩包里没有找到从 1 开始连续编号的测试点")
  if (options.sql && selected.length < 2) {
    // 题目页会展示测试点 1 的期望结果，只有一个测试点时学生可以对照着硬编码 AC
    throw new TestCaseError("SQL 题至少需要 2 个数据不同的测试点，防止硬编码期望结果")
  }

  let total = 0
  const contents = new Map<string, Uint8Array>()
  for (const name of selected) {
    const raw = files[name]!
    if (raw.length > MAX_ENTRY_BYTES) {
      throw new TestCaseError(`测试点 ${name} 超过 ${MAX_ENTRY_BYTES / 1024 / 1024}MB`)
    }
    const content = normalizeNewlines(raw)
    total += content.length
    if (total > MAX_TOTAL_BYTES) {
      throw new TestCaseError(`测试点总大小超过 ${MAX_TOTAL_BYTES / 1024 / 1024}MB`)
    }
    contents.set(name, content)
  }

  const testCaseId = randomId()
  const directory = resolve(config.testCaseDirectory, testCaseId)
  await mkdir(directory, { recursive: true })
  await chmod(directory, 0o710)

  for (const [name, content] of contents) {
    await writeFile(resolve(directory, name), content)
    await chmod(resolve(directory, name), 0o640)
  }

  const info: TestCaseEntry[] = []
  const testCases: Record<string, TestCaseEntry> = {}
  if (options.sql) {
    // SQL 题：每个 N.sql 是一个测试点的建表+数据脚本，没有期望输出（判题时跑标准答案生成）。
    // output_name 复用同名、md5 置空，以兼容前端的测试点表格。
    selected.forEach((name, index) => {
      const entry: TestCaseEntry = {
        stripped_output_md5: "",
        input_size: contents.get(name)!.length,
        output_size: 0,
        input_name: name,
        output_name: name,
      }
      info.push(entry)
      testCases[String(index + 1)] = entry
    })
  } else {
    collectPairs(names).forEach(([input, output], index) => {
      const outputContent = contents.get(output)!
      const entry: TestCaseEntry = {
        stripped_output_md5: createHash("md5").update(rstrip(outputContent)).digest("hex"),
        input_size: contents.get(input)!.length,
        output_size: outputContent.length,
        input_name: input,
        output_name: output,
      }
      info.push(entry)
      testCases[String(index + 1)] = entry
    })
  }

  const payload: Record<string, unknown> = { test_cases: testCases }
  if (options.sql) payload.sql = true
  const infoPath = resolve(directory, "info")
  await writeFile(infoPath, JSON.stringify(payload, null, 4), "utf8")
  await chmod(infoPath, 0o640)

  return { testCaseId, info }
}

/** 把一个测试点目录重新打包成 zip 供后台下载 */
export async function packTestCaseZip(testCaseId: string) {
  const directory = resolve(config.testCaseDirectory, testCaseId)
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    throw new TestCaseError("Test case does not exists")
  }
  const names = new Set(entries)
  const isSql = await readInfo(testCaseId).then((info) => Boolean(info?.sql)).catch(() => false)
  const selected = isSql ? collectSqlScripts(names) : collectPairs(names).flat()
  const bundle: Record<string, Uint8Array> = {}
  for (const name of [...selected, "info"]) {
    if (!names.has(name)) continue
    bundle[name] = new Uint8Array(await readFile(resolve(directory, name)))
  }
  return zipSync(bundle)
}

export async function readInfo(testCaseId: string) {
  const path = resolve(config.testCaseDirectory, testCaseId, "info")
  try {
    return JSON.parse(await readFile(path, "utf8")) as {
      sql?: boolean
      test_cases?: Record<string, TestCaseEntry>
    }
  } catch {
    return null
  }
}

/** 读回 SQL 测试点的脚本内容，供后台回显 */
export async function readSqlScripts(testCaseId: string) {
  const directory = resolve(config.testCaseDirectory, testCaseId)
  const names = collectSqlScripts(new Set(await readdir(directory)))
  const scripts: { name: string; content: string }[] = []
  for (const name of names) {
    scripts.push({ name, content: await readFile(resolve(directory, name), "utf8") })
  }
  return scripts
}

function randomId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("")
}
