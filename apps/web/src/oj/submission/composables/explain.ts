import { explainCCompileError } from "oj/problem/utils/cError"
import { explainPythonCompileError } from "oj/problem/utils/pythonError"
import { explainRuntimeError } from "oj/problem/utils/runtimeError"
import { SubmissionStatus } from "utils/constants"
import type { Submission } from "utils/types"
import { useTone } from "./tone"

export interface SubmissionExplain {
  /** 错在第几行（编辑器里那一行标红），说不出来的为 null */
  line: number | null
  text: string
  /** 判题机的原始报错，收在「原始报错」里；没有就是空串 */
  raw: string
}

function stripJudgePath(text: string) {
  return text.replace(/\/judger\/run\/[^/"]+\//g, "")
}

/**
 * 编译失败 / 运行时错误说清楚「错在第几行、为什么」—— 翻译表和题目页结果区同一份
 * （pythonError.ts / cError.ts / runtimeError.ts）。提交列表右栏和独立的提交详情页共用。
 */
export function useSubmissionExplain(submission: Ref<Submission | null | undefined>) {
  const tone = useTone()

  const explain = computed<SubmissionExplain | null>(() => {
    const s = submission.value
    if (!s || !s.showLink) return null
    const info = s.statisticInfo
    const err = info?.err_info ? stripJudgePath(info.err_info) : ""
    switch (s.result) {
      case SubmissionStatus.compile_error: {
        const ex = !err
          ? null
          : s.language === "Python"
            ? explainPythonCompileError(err, s.code)
            : s.language === "C" || s.language === "C++"
              ? explainCCompileError(err, s.code, s.language)
              : null
        if (ex) return { line: ex.line, text: ex.message, raw: err }
        return { line: null, text: "编译没通过，看看下面的原始报错。", raw: err }
      }
      case SubmissionStatus.runtime_error: {
        const rt = info?.runtime_error
        if (rt) return { line: rt.line ?? null, text: explainRuntimeError(rt, s.code), raw: err }
        return { line: null, text: "程序运行到一半出错，停下来了。", raw: err }
      }
      case SubmissionStatus.cpu_time_limit_exceeded:
      case SubmissionStatus.real_time_limit_exceeded:
        return {
          line: null,
          text: "程序跑了太久还没结束：可能有死循环，或者在等一个没有给的输入。",
          raw: "",
        }
      case SubmissionStatus.memory_limit_exceeded:
        return { line: null, text: "程序占的内存太多了。", raw: "" }
      case SubmissionStatus.system_error:
        return { line: null, text: "判题机出错了，不是代码的问题。", raw: err }
      case SubmissionStatus.wrong_answer: {
        const check = info?.sample_check
        if (!check) return null
        // 「题目里的」不能省：上面那排格子是测试点，也从 1 编号，只写「例子 1」时老师看到
        // 格子 1 是绿的，以为说明写反了（例子 1 是题面样例，和测试点 1 不是一组数据）
        const text = check.passed
          ? "题目里的例子都对，错在没公开的测试点上。"
          : `题目里的例子 ${(check.index ?? 0) + 1} 就错了。`
        return { line: null, text, raw: "" }
      }
      case SubmissionStatus.ast_check_failed: {
        const failedRules = (info?.ast_results ?? []).filter((rule) => !rule.passed)
        const text = failedRules.length
          ? `答案对了，但没按要求写：${failedRules.map((rule) => rule.description).join("；")}`
          : "答案对了，但没按题目要求的写法写。"
        return { line: null, text, raw: "" }
      }
      default:
        return null
    }
  })

  const explainTone = computed(() => {
    const r = submission.value?.result
    return tone(
      r === SubmissionStatus.compile_error ||
        r === SubmissionStatus.runtime_error ||
        r === SubmissionStatus.ast_check_failed
        ? "warning"
        : r === SubmissionStatus.system_error
          ? "default"
          : "error",
    )
  })

  return { explain, explainTone }
}
