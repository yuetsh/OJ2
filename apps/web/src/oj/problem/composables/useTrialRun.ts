import type { StatisticInfo, TrialRunResponse } from "@oj2/contract"
import { errorMessage } from "utils/api"
import { SubmissionStatus } from "utils/constants"
import { isRunnableLanguage, trialRun } from "utils/judge"
import type { Code } from "utils/types"

/**
 * 试跑：「运行例子」和「自己输入」。走本站判题机（utils/judge.ts → POST /trial-runs），
 * 不算提交。和提交是同一台判题机、同一套编译命令、这道题的时间内存限制和代码模板，
 * 所以例子上跑出来什么样，提交在这几个例子上就是什么样。
 *
 * 结果码就是判题机那套（SubmissionStatus），直接交给 WrongAnswerExplain 和 JUDGE_STATUS。
 * 对不对也是判题机比的（去掉末尾空白再比，和提交一样），这边不再自己比。
 */

/** 试跑的是哪道题：按这道题的限制和模板跑 */
export interface TrialTarget {
  problemId: number
  contestId: number | null
}

/** 一组跑下来的结果 */
interface TrialOutcome {
  result: SubmissionStatus
  output: string
  /** 没跑成、或者要换一种说法时给学生看的中文，有它就不用 TrialErrorNote 的默认说明 */
  note?: string
  /** 运行时错误的诊断（第几行、什么异常），和提交的同一套，交给 RuntimeErrorExplain */
  runtimeError?: NonNullable<StatisticInfo["runtime_error"]>
}

const TOO_MUCH_OUTPUT =
  "程序输出太多了，一直停不下来：多半是循环没有结束的条件（条件一直成立、循环变量忘了改），在不停地打印。"

/**
 * 把一次试跑的回包摊成每组一条。编译没过就每组都是编译失败、带同一份报错；
 * 输出太多的时候判题机回包被掐断了，分不出是哪一组，每组都挂上同一句说明。
 */
function outcomes(response: TrialRunResponse, count: number): TrialOutcome[] {
  if (response.status === "compile-error") {
    return Array.from({ length: count }, () => ({
      result: SubmissionStatus.compile_error,
      output: response.message,
    }))
  }
  if (response.status === "too-much-output") {
    return Array.from({ length: count }, () => ({
      result: SubmissionStatus.runtime_error,
      output: "",
      note: TOO_MUCH_OUTPUT,
    }))
  }
  // 跑完了（对或错）只去掉末尾空白（print 带的那个换行），判题机比对时也不看它；
  // 开头的空格是输出的一部分（打印菱形、三角形），不能动
  return response.cases.map((item) => {
    const result = item.result as SubmissionStatus
    const finished =
      result === SubmissionStatus.accepted || result === SubmissionStatus.wrong_answer
    return {
      result,
      output: finished ? item.output.trimEnd() : item.output,
      ...(item.runtimeError ? { runtimeError: item.runtimeError } : {}),
    }
  })
}

async function runCases(
  code: Code,
  target: TrialTarget,
  cases: { input: string; output?: string }[],
): Promise<TrialOutcome[]> {
  if (!isRunnableLanguage(code.language)) {
    return cases.map(() => ({
      result: SubmissionStatus.system_error,
      output: "",
      note: `${code.language} 不能试运行`,
    }))
  }
  try {
    const response = await trialRun({
      problemId: target.problemId,
      contestId: target.contestId ?? undefined,
      language: code.language,
      code: code.value,
      cases,
    })
    return outcomes(response, cases.length)
  } catch (error) {
    // 后端的文案是给学生看的（「上一次还没跑完」「试运行的人太多了」）
    const note = errorMessage(error, "试跑的服务暂时连不上，稍后再试一次。")
    return cases.map(() => ({ result: SubmissionStatus.system_error, output: "", note }))
  }
}

export interface SampleRun {
  /** 第几个例子，0 起 */
  index: number
  input: string
  expected: string
  output: string
  result: SubmissionStatus
  note?: string
  runtimeError?: TrialOutcome["runtimeError"]
}

export function useTrialRun() {
  const sampleRuns = ref<SampleRun[]>([])
  const samplesRunning = ref(false)
  /** 最近一次运行例子是什么时候（ISO），显示在结果页签里 */
  const samplesRunAt = ref<string | null>(null)
  /** 跑例子时用的那份代码：错因说明要看代码（比如有没有 input("提示文字")），编辑器里可能已经改了 */
  const samplesCode = ref<Code | null>(null)

  const customInput = ref("")
  const customOutput = ref("")
  const customResult = ref<SubmissionStatus | null>(null)
  const customNote = ref("")
  const customRuntimeError = ref<TrialOutcome["runtimeError"] | null>(null)
  /** 跑「自己输入」时用的那份代码：出错那一行要从它里面摆出来，编辑器里可能已经改了 */
  const customCode = ref("")
  const customRunning = ref(false)

  /**
   * 每次开跑 +1。跑的这一会儿换了题、或者又点了一次，旧的那批回来就扔掉。
   * 两边各记各的：一边在跑的时候点另一边，不能把这边的结果也扔了、转圈转个没完
   */
  let samplesGeneration = 0
  let customGeneration = 0

  async function runSamples(
    code: Code,
    target: TrialTarget,
    samples: { input: string; output: string }[],
  ) {
    const mine = ++samplesGeneration
    samplesRunning.value = true
    const runs = await runCases(code, target, samples)
    if (mine !== samplesGeneration) return
    sampleRuns.value = samples.map((sample, index) => ({
      index,
      input: sample.input,
      expected: sample.output,
      ...runs[index]!,
    }))
    samplesRunAt.value = new Date().toISOString()
    samplesCode.value = code
    samplesRunning.value = false
  }

  async function runCustom(code: Code, target: TrialTarget) {
    const mine = ++customGeneration
    customRunning.value = true
    // 自己输入的没有标准答案，不给 output：跑完没出错就算「对」
    const [run] = await runCases(code, target, [{ input: customInput.value }])
    if (mine !== customGeneration) return
    customOutput.value = run!.output
    customResult.value = run!.result
    customNote.value = run!.note ?? ""
    customRuntimeError.value = run!.runtimeError ?? null
    customCode.value = code.value
    customRunning.value = false
  }

  /** 换题：两边都清掉。输入框也清 —— 那是给上一道题编的数据 */
  function resetTrial() {
    samplesGeneration++
    customGeneration++
    sampleRuns.value = []
    samplesRunning.value = false
    samplesRunAt.value = null
    samplesCode.value = null
    customInput.value = ""
    customOutput.value = ""
    customResult.value = null
    customNote.value = ""
    customRuntimeError.value = null
    customCode.value = ""
    customRunning.value = false
  }

  return {
    sampleRuns,
    samplesRunning,
    samplesRunAt,
    samplesCode,
    customInput,
    customOutput,
    customResult,
    customNote,
    customRuntimeError,
    customCode,
    customRunning,
    runSamples,
    runCustom,
    resetTrial,
  }
}
