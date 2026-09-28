<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useThemeVars } from "naive-ui"
import { useProblemStore } from "oj/store/problem"
import { markdownToText } from "oj/problem/utils/plainText"
import { JUDGE_STATUS, SubmissionStatus } from "utils/constants"
import {
  classifyDiff,
  explainDiff,
  firstDifferentLine,
  type SampleCheck,
} from "oj/problem/utils/wrongAnswer"

/**
 * 答案错误时的样例对比（数据见后端 judge/run.ts 的 checkSamples）。
 * 全是公开信息：样例写在题面上，「你的输出」是学生自己的程序在公开输入上的输出。
 */
const props = defineProps<{
  check: SampleCheck
  code: string
  language: string
  /**
   * 只摆输入、正确输出、你的输出，不给中文提示句。比赛里的「运行例子」用：后端在比赛里
   * 故意不做例子对比（judge/run.ts：比赛里有期末考试，格式提示在那里不该给），
   * 前端试跑也不能绕过去
   */
  plain?: boolean
  /**
   * 提交结果里用：末尾摆出题目对输出的原话，例子都对时再给「去自己输入试试」。
   * 格式错、漏了一行这类错误，对着题目原话一看就明白；运行例子那边不需要
   */
  full?: boolean
}>()

const theme = useThemeVars()
const { problem } = storeToRefs(useProblemStore())

/**
 * 卡片末尾那行「题目原话」（设计稿「答案错误」「错在隐藏测试点」）：
 * 例子上就错了 —— 摆题面「输出」那一节，格式错、漏了一行这类，对着原话一看就明白；
 * 例子都对了、错在隐藏测试点 —— 摆「描述」，边界条件多半写在那里。SQL 题两节都不摆
 */
const requirement = computed(() => {
  if (!props.full || !problem.value || problem.value.sqlConfig) return null
  const source = props.check.passed ? problem.value.description : problem.value.outputDescription
  const text = markdownToText(source ?? "", props.check.passed ? 160 : 120)
  if (!text) return null
  return { label: props.check.passed ? "题目原话" : "题目要求的输出", text }
})

/** 后端每段截到 2000 字，到了上限就是被截过 */
const TEXT_LIMIT = 2000

const onSample = computed(() => props.check.result === SubmissionStatus.wrong_answer)
const kind = computed(() =>
  onSample.value ? classifyDiff(props.check.expected ?? "", props.check.output ?? "") : null,
)
const hint = computed(() => {
  if (props.check.passed) return ""
  if (!kind.value) {
    const name = JUDGE_STATUS[props.check.result as keyof typeof JUDGE_STATUS]?.name ?? "出错了"
    return `你的程序在这个例子上就「${name}」了，先让它在例子上跑通。`
  }
  return explainDiff(kind.value, props.check, props.code, props.language)
})
const diffLine = computed(() =>
  firstDifferentLine(props.check.expected ?? "", props.check.output ?? ""),
)

/**
 * 不一样的那一行，拆成「相同的开头 / 不同的中间 / 相同的结尾」三段，只把中间那段标红
 * （设计稿：多出来的「等级：」、错成的「E」、多出来的「333333333333」）。
 * 标在「你的输出」上；你的输出那段是空的（少了东西）就标在正确输出上，告诉他少了什么
 */
function splitDiff(expected: string, output: string) {
  const e = [...expected]
  const o = [...output]
  let head = 0
  while (head < e.length && head < o.length && e[head] === o[head]) head++
  let tail = 0
  while (
    tail < e.length - head &&
    tail < o.length - head &&
    e[e.length - 1 - tail] === o[o.length - 1 - tail]
  )
    tail++
  const cut = (chars: string[]) => ({
    before: chars.slice(0, head).join(""),
    marked: chars.slice(head, chars.length - tail).join(""),
    after: chars.slice(chars.length - tail).join(""),
  })
  const mine = cut(o)
  const theirs = cut(e)
  return mine.marked ? { output: mine, expected: null } : { output: null, expected: theirs }
}

const diffParts = computed(() => {
  if (!onSample.value || diffLine.value < 0) return null
  const expected = lines(props.check.expected ?? "")[diffLine.value] ?? ""
  const output = lines(props.check.output ?? "")[diffLine.value] ?? ""
  return splitDiff(expected, output)
})

/**
 * 只差空白的时候把空白画出来，不然两边看着一模一样。
 *
 * 末尾的空白先去掉：判题比的是整个输出去掉末尾空白之后的样子（JudgeServer 的
 * stripped_output_md5），print 自己带的那个换行不算错。画出来的话，学生会以为
 * 是结尾那个「↵」惹的祸。
 */
function lines(text: string) {
  const visible = kind.value === "whitespace"
  const parts = text.replace(/\s+$/, "").split("\n")
  return parts.map((line, i) => {
    if (!visible) return line
    const ending = i < parts.length - 1 ? "↵" : ""
    return line.replace(/ /g, "·").replace(/\t/g, "→") + ending
  })
}
</script>

<template>
  <div class="explain-card">
    <p v-if="check.passed" class="explain">
      题目里的例子都对了，没通过的是隐藏的测试点。想想特殊情况：最大的数、最小的数、0、负数，或者题目里专门提到的情况。
    </p>
    <template v-else>
      <p class="explain">
        <b>例子 {{ (check.index ?? 0) + 1 }} 没有通过{{ plain ? "。" : "：" }}</b
        ><template v-if="!plain">{{ hint }}</template>
      </p>
      <div class="blocks">
        <div class="block">
          <div class="label">输入</div>
          <div class="text">
            <div
              v-for="(line, i) in (check.input ?? '').split('\n')"
              :key="i"
              class="line"
              v-text="line"
            />
          </div>
        </div>
        <div class="block">
          <div class="label">正确输出</div>
          <div class="text">
            <template v-for="(line, i) in lines(check.expected ?? '')" :key="i">
              <div v-if="i === diffLine && diffParts?.expected" class="line">
                <span v-text="diffParts.expected.before" /><span
                  class="diff"
                  v-text="diffParts.expected.marked"
                /><span v-text="diffParts.expected.after" />
              </div>
              <div v-else class="line" v-text="line" />
            </template>
          </div>
        </div>
        <div class="block">
          <div class="label">你的输出</div>
          <div v-if="check.output" class="text">
            <template v-for="(line, i) in lines(check.output)" :key="i">
              <div v-if="i === diffLine && diffParts?.output" class="line">
                <span v-text="diffParts.output.before" /><span
                  class="diff"
                  v-text="diffParts.output.marked"
                /><span v-text="diffParts.output.after" />
              </div>
              <div v-else class="line" v-text="line" />
            </template>
          </div>
          <div v-else class="text empty">（什么都没有输出）</div>
          <div v-if="check.output && check.output.length >= TEXT_LIMIT" class="cut">
            输出太长，只显示了前面一部分
          </div>
        </div>
      </div>
    </template>
    <p v-if="requirement" class="requirement">{{ requirement.label }}：{{ requirement.text }}</p>
  </div>
</template>

<style scoped>
/* 设计稿「答案错误」：一块浅灰卡片，三栏并排的白底小框 */
.explain-card {
  padding: 12px 14px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.06);
  border: 1px solid v-bind("theme.dividerColor");
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.explain {
  margin: 0;
  line-height: 1.7;
}

.blocks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.block {
  min-width: 0;
  padding: 6px 10px 8px;
  border-radius: 5px;
  background-color: v-bind("theme.cardColor");
  border: 1px solid v-bind("theme.dividerColor");
}

.label {
  font-size: 12px;
  color: v-bind("theme.textColor3");
  margin-bottom: 3px;
}

.text {
  font-family: Consolas, Monaco, monospace;
  font-size: 14px;
  line-height: 1.6;
  max-height: 200px;
  overflow: auto;
}

/* 每行用 v-text 填，不写 {{ line }}：模板里标签两边的换行缩进会被 Vue 压成一个空格，
   配上 white-space: pre 就是每行开头多一个空格 —— 在一个专门比对空格的地方，这不能有 */
.line {
  white-space: pre;
  min-height: 1.6em;
}

.diff {
  background-color: rgba(208, 48, 80, 0.18);
  color: v-bind("theme.errorColorPressed");
}

.empty {
  color: v-bind("theme.textColor3");
  font-family: inherit;
  font-size: 13px;
}

.cut {
  margin-top: 4px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.requirement {
  margin: 0;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  line-height: 1.6;
}
</style>
