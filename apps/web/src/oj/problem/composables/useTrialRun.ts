import { createTestSubmission } from "utils/judge"
import { SubmissionStatus } from "utils/constants"
import type { Code } from "utils/types"

/**
 * 试跑：「运行例子」和「自己输入」。走 Judge0（utils/judge.ts），不经过判题机、不算提交。
 *
 * 编译器版本和判题机不一样（Judge0 的 C 是 GCC 9，判题机是 gcc-14 加宽松参数），
 * 所以这里的结果偶尔会和提交不一致 —— 这是拍板过的取舍（设计文档第 3 节决定 3）。
 */

/** Judge0 的状态码（见 Judge0 的 /statuses）。同步调用（wait=true）只会拿到终态 */
const JUDGE0_ACCEPTED = 3
const JUDGE0_TIME_LIMIT = 5
const JUDGE0_COMPILE_ERROR = 6
const isJudge0RuntimeError = (status: number) => status >= 7 && status <= 12

/**
 * Python 的语法错误。Judge0 的 Python 没有编译这一步，SyntaxError 回来的是运行时错误
 * （status 11），得看回溯的最后一行才认得出来
 */
const PYTHON_SYNTAX_ERROR = /^(SyntaxError|IndentationError|TabError): /m

/**
 * 把 Judge0 的状态换成判题机那套码，好直接交给 WrongAnswerExplain 和 JUDGE_STATUS。
 * 跑完、只是输出对不上的，按答案错误算。Python 的语法错误按编译失败算：
 * 学生最常犯的中文冒号、中文括号，原来在这里被说成「程序运行到一半出错……下标有没有越界」
 */
export function trialStatus(status: number | null, passed: boolean, output: string) {
  if (status === JUDGE0_ACCEPTED) {
    return passed ? SubmissionStatus.accepted : SubmissionStatus.wrong_answer
  }
  if (status === JUDGE0_TIME_LIMIT) return SubmissionStatus.real_time_limit_exceeded
  if (status === JUDGE0_COMPILE_ERROR) return SubmissionStatus.compile_error
  if (status !== null && isJudge0RuntimeError(status)) {
    return PYTHON_SYNTAX_ERROR.test(output)
      ? SubmissionStatus.compile_error
      : SubmissionStatus.runtime_error
  }
  return SubmissionStatus.system_error
}

/**
 * 判题机比的是去掉末尾空白之后的输出（JudgeServer 的 stripped_output_md5），
 * 这里两边都去。原来题目页的「测试」按钮只 trim 了运行输出，样例输出末尾带个
 * 空格或换行，就永远显示「不通过」。
 */
const sameOutput = (output: string, expected: string) => output.trimEnd() === expected.trimEnd()

export interface SampleRun {
  /** 第几个例子，0 起 */
  index: number
  input: string
  expected: string
  output: string
  /** 换算成判题机那套码之后的结果，见 trialStatus */
  result: SubmissionStatus
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
  const customRunning = ref(false)

  /**
   * 每次开跑 +1。跑的这一会儿换了题、或者又点了一次，旧的那批回来就扔掉。
   * 两边各记各的：一边在跑的时候点另一边，不能把这边的结果也扔了、转圈转个没完
   */
  let samplesGeneration = 0
  let customGeneration = 0

  async function runOne(code: Code, input: string) {
    try {
      return await createTestSubmission(code, input)
    } catch {
      return { status: null, output: "" }
    }
  }

  async function runSamples(code: Code, samples: { input: string; output: string }[]) {
    const mine = ++samplesGeneration
    samplesRunning.value = true
    // 例子一般两三个，一起发
    const outputs = await Promise.all(samples.map((sample) => runOne(code, sample.input)))
    if (mine !== samplesGeneration) return
    sampleRuns.value = samples.map((sample, index) => {
      const run = outputs[index]!
      const passed = run.status === JUDGE0_ACCEPTED && sameOutput(run.output, sample.output)
      return {
        index,
        input: sample.input,
        expected: sample.output,
        output: run.output,
        result: trialStatus(run.status, passed, run.output),
      }
    })
    samplesRunAt.value = new Date().toISOString()
    samplesCode.value = code
    samplesRunning.value = false
  }

  async function runCustom(code: Code) {
    const mine = ++customGeneration
    customRunning.value = true
    const run = await runOne(code, customInput.value)
    if (mine !== customGeneration) return
    customOutput.value = run.output
    // 自己输入的没有标准答案，跑完就算「对」，只看有没有出错
    customResult.value = trialStatus(run.status, true, run.output)
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
    customRunning,
    runSamples,
    runCustom,
    resetTrial,
  }
}
