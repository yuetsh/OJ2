import { TEST_CASE_EDIT_MAX_CASES, TEST_CASE_EDIT_MAX_FILE_BYTES } from "@oj2/contract"
import type { RunnableLanguage } from "@oj2/contract"
import { strFromU8, unzipSync } from "fflate"
import type { Ref } from "vue"
import { errorMessage } from "utils/api"
import { JUDGE_STATUS, SubmissionStatus } from "utils/constants"
import { trialRun } from "utils/judge"

/**
 * 编程题出题页的测试数据（设计稿「编程题出题页」B）：一组一行，输出由标准答案在判题机上
 * 跑出来，勾上「当例子」的几组按顺序写进题面的例子。
 *
 * 没有标准答案时（老题，954 道里 497 道）输出是手写的 —— 当初上传的文件原样读回来，
 * 老师直接改；写上答案以后就改成跟着答案跑。
 */
export interface CaseRow {
  key: number
  input: string
  /** 有标准答案时是答案跑出来的，没有时是手写的 */
  output: string
  example: boolean
  /** 从文件读回来时存着的输出。答案跑出来的和它不一样，就标「变了」 */
  saved: string | null
  /** 最近一次跑完对应的是哪一版（见 signatureOf） */
  ranFor: string
  /** 标准答案在这组上没跑通的原因 */
  error: string
}

/** 拿来跑测试数据的那份标准答案。已经套好了题目模板的前后两段 */
export interface AnswerSource {
  language: RunnableLanguage
  code: string
}

export type CaseStatus = "manual" | "empty" | "running" | "error" | "changed" | "ok"

let nextKey = 0

export function newRow(input = "", output = "", example = false, saved: string | null = null) {
  return {
    key: nextKey++,
    input,
    output,
    example,
    saved,
    ranFor: "",
    error: "",
  } satisfies CaseRow
}

/** 判题机比对时去掉的是整段输出末尾的空白（见 services/test-case.ts 的 rstrip），这里同一个口径 */
export function sameOutput(a: string, b: string) {
  return a.replace(/\r\n/g, "\n").trimEnd() === b.replace(/\r\n/g, "\n").trimEnd()
}

const signatureOf = (source: AnswerSource, row: CaseRow) =>
  JSON.stringify([source.language, source.code, row.input])

export function caseStatus(row: CaseRow, source: AnswerSource | null): CaseStatus {
  if (!source) return "manual"
  if (row.ranFor !== signatureOf(source, row)) return "running"
  if (row.error) return "error"
  if (row.saved !== null && !sameOutput(row.saved, row.output)) return "changed"
  return "ok"
}

/** 答案报错时给老师看的一句话：状态 + 输出的最后一行（Python 的异常原文就在那） */
function describeFailure(result: SubmissionStatus, output: string, line?: number | null) {
  const name = JUDGE_STATUS[result]?.name ?? "没跑通"
  const last = output.trimEnd().split("\n").at(-1)?.trim()
  const where = line ? `（第 ${line} 行）` : ""
  return last ? `${name}：${last}${where}` : `${name}${where}`
}

/**
 * 测试数据的重跑：一次只跑一批（后端每人同时最多两批，见 judge/trial.ts），
 * 跑的过程中又改了就记一笔，跑完再补一轮。
 */
export function useCaseRunner(rows: Ref<CaseRow[]>, source: Ref<AnswerSource | null>) {
  const running = ref(false)
  let again = false

  async function runAll() {
    if (running.value) {
      again = true
      return
    }
    const answer = source.value
    if (!answer) return
    const todo = rows.value.filter((row) => row.ranFor !== signatureOf(answer, row))
    if (!todo.length) return
    running.value = true
    try {
      for (let start = 0; start < todo.length; start += 50) {
        const batch = todo.slice(start, start + 50)
        const signatures = batch.map((row) => signatureOf(answer, row))
        try {
          const response = await trialRun({
            language: answer.language,
            code: answer.code,
            cases: batch.map((row) => ({ input: row.input })),
          })
          batch.forEach((row, i) => {
            row.ranFor = signatures[i]!
            if (response.status === "compile-error") {
              row.output = ""
              row.error = `标准答案编译不过：${response.message.trim().split("\n").at(-1) ?? ""}`
            } else if (response.status === "too-much-output") {
              row.output = ""
              row.error = "输出太多（多半是死循环在不停打印）"
            } else {
              const run = response.cases[i]!
              if (run.result === SubmissionStatus.accepted) {
                row.output = run.output.trimEnd()
                row.error = ""
              } else {
                row.output = ""
                row.error = describeFailure(run.result, run.output, run.runtimeError?.line)
              }
            }
          })
        } catch (err) {
          // 判题机忙、连不上：这一批记成没跑通，别无限重试；老师点「重跑」再来
          const reason = errorMessage(err, "判题机暂时连不上")
          batch.forEach((row, i) => {
            row.ranFor = signatures[i]!
            row.error = reason
          })
        }
      }
    } finally {
      running.value = false
      if (again) {
        again = false
        void runAll()
      }
    }
  }

  /** 「重跑」：把没跑通的几组作废重来 */
  function rerunFailed() {
    rows.value.forEach((row) => {
      if (row.error) row.ranFor = ""
    })
    void runAll()
  }

  return { running, runAll, rerunFailed }
}

/**
 * 导入 zip：在浏览器里拆成一组组。和后端 collectPairs 同一个规矩 —— 从 1.in / 1.out
 * 开始连续编号，断了就停。太大（见契约 TEST_CASE_EDIT_*）就不拆，交给调用方直接上传。
 */
export function readCaseZip(
  archive: Uint8Array,
): { ok: true; cases: { input: string; output: string }[] } | { ok: false; reason: string } {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(archive, { filter: (file) => /^\d+\.(in|out)$/.test(file.name) })
  } catch {
    return { ok: false, reason: "压缩包损坏，或者不是 zip" }
  }
  const cases: { input: string; output: string }[] = []
  for (let i = 1; files[`${i}.in`] && files[`${i}.out`]; i += 1) {
    const input = files[`${i}.in`]!
    const output = files[`${i}.out`]!
    if (
      input.length > TEST_CASE_EDIT_MAX_FILE_BYTES ||
      output.length > TEST_CASE_EDIT_MAX_FILE_BYTES
    )
      return { ok: false, reason: "too-large" }
    cases.push({ input: strFromU8(input), output: strFromU8(output) })
  }
  if (!cases.length)
    return { ok: false, reason: "压缩包里没有从 1.in / 1.out 开始连续编号的测试点" }
  if (cases.length > TEST_CASE_EDIT_MAX_CASES) return { ok: false, reason: "too-large" }
  return { ok: true, cases }
}

/** 打包上传前的文件内容：CRLF 统一成 LF，非空输入补结尾换行（C 的 scanf / gets 读最后一行更稳） */
export function caseFiles(rows: { input: string; output: string }[]) {
  const lf = (text: string) => text.replace(/\r\n/g, "\n")
  return rows.flatMap((row, i) => {
    const input = lf(row.input)
    return [
      { name: `${i + 1}.in`, content: input && !input.endsWith("\n") ? `${input}\n` : input },
      { name: `${i + 1}.out`, content: lf(row.output) },
    ]
  })
}
