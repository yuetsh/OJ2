<script setup lang="ts">
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
}>()

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
  <n-card embedded class="explain-card">
    <div v-if="check.passed" class="explain">
      题目里的例子都对了，没通过的是隐藏的测试点。想想特殊情况：最大的数、最小的数、0、负数，或者题目里专门提到的情况。
    </div>
    <n-flex v-else vertical :size="12">
      <div class="explain">
        <b>例子 {{ (check.index ?? 0) + 1 }} 没有通过{{ plain ? "。" : "：" }}</b
        ><template v-if="!plain">{{ hint }}</template>
      </div>
      <div class="blocks">
        <div class="block input">
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
            <div
              v-for="(line, i) in lines(check.expected ?? '')"
              :key="i"
              class="line"
              :class="{ diff: onSample && i === diffLine }"
              v-text="line"
            />
          </div>
        </div>
        <div class="block">
          <div class="label">你的输出</div>
          <div v-if="check.output" class="text">
            <div
              v-for="(line, i) in lines(check.output)"
              :key="i"
              class="line"
              :class="{ diff: onSample && i === diffLine }"
              v-text="line"
            />
          </div>
          <div v-else class="text empty">（什么都没有输出）</div>
          <n-text v-if="check.output && check.output.length >= TEXT_LIMIT" depth="3" class="cut">
            输出太长，只显示了前面一部分
          </n-text>
        </div>
      </div>
    </n-flex>
  </n-card>
</template>

<style scoped>
.explain-card {
  max-width: 560px;
}

.explain {
  font-size: 16px;
  line-height: 1.7;
}

.blocks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.block {
  min-width: 0;
}

.block.input {
  grid-column: 1 / -1;
}

.label {
  font-size: 13px;
  opacity: 0.7;
  margin-bottom: 4px;
}

.text {
  margin: 0;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.6;
  max-height: 200px;
  overflow: auto;
  background-color: rgba(128, 128, 128, 0.1);
}

/* 每行用 v-text 填，不写 {{ line }}：模板里标签两边的换行缩进会被 Vue 压成一个空格，
   配上 white-space: pre 就是每行开头多一个空格 —— 在一个专门比对空格的地方，这不能有 */
.line {
  white-space: pre;
  min-height: 1.6em;
}

.diff {
  background-color: rgba(208, 48, 80, 0.2);
}

.empty {
  opacity: 0.6;
}

.cut {
  font-size: 12px;
}
</style>
