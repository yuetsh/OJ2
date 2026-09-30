<script setup lang="ts">
import { SubmissionStatus } from "utils/constants"
import type { StatisticInfo } from "@oj2/contract"
import CompileErrorExplain from "./CompileErrorExplain.vue"
import RuntimeErrorExplain from "./RuntimeErrorExplain.vue"

/**
 * 试跑没跑完时给学生看的中文说明。判题机回来的是英文原文（Traceback、gcc 的报错），
 * 学生读不懂，原文收进折叠区。Python 的语法错误是判题机上 CPython 的原文，和提交判出来的
 * 一样，直接交给 CompileErrorExplain（中文说明 + 编辑器里标出位置 + 一键换中文标点），
 * C / C++ 的 gcc 报错同理。
 */
const props = defineProps<{
  result: SubmissionStatus
  output: string
  language: string
  /** 调用方给的说明（没跑成的原因、输出太多），有它就不用下面按结果码挑的那句 */
  note?: string
  /** 运行时错误的诊断（后端和提交同一个解析），有它就说清楚第几行、为什么 */
  runtimeError?: NonNullable<StatisticInfo["runtime_error"]> | null
  /** 跑的那份代码，摆出出错的那一行 */
  code?: string
  /**
   * 比赛里：不给具体到哪一行、什么原因的说明（设计文档第 8 节「运行例子只给对 / 没对上和
   * 原样输出」；提交那边比赛里也只给判题状态），只留按结果码的那一句
   */
  plain?: boolean
}>()

/** 运行时错误、而且诊断出了东西：用和提交一样的说明卡片（第几行 + 中文原因 + 编辑器标红） */
const runtimeExplain = computed(
  () =>
    !props.note &&
    !props.plain &&
    props.result === SubmissionStatus.runtime_error &&
    !!props.runtimeError,
)

const compileError = computed(
  () =>
    !props.note &&
    props.result === SubmissionStatus.compile_error &&
    ["Python", "C", "C++"].includes(props.language) &&
    !!props.output,
)

const message = computed(() => {
  if (props.note) return props.note
  switch (props.result) {
    case SubmissionStatus.compile_error:
      return props.language === "Python"
        ? "代码有语法错误，程序一行都没跑。最常见的是用了中文标点（，：（）“”）。"
        : "代码没能编译通过，写法有错误。看看是不是漏了分号、括号没配对、变量没声明。"
    case SubmissionStatus.runtime_error:
      return "程序运行到一半出错，停下来了。检查一下输入是怎么读的、下标有没有越界、除数是不是 0。"
    case SubmissionStatus.cpu_time_limit_exceeded:
    case SubmissionStatus.real_time_limit_exceeded:
      return "运行超时了：程序跑了太久还没结束。看看是不是有死循环（条件一直成立、循环变量忘了改），或者在等一个例子里没有的输入（多写了一个 input）。"
    case SubmissionStatus.memory_limit_exceeded:
      return "程序占的内存太多了。通常是列表、数组开得太大，或者在循环里不停地往里加东西、停不下来。"
    default:
      return "试跑的服务暂时连不上，稍后再试一次。"
  }
})

/** 判题机的临时目录名（`/judger/run/<32 位随机串>/`）对学生没有意义，只剩文件名 */
const rawOutput = computed(() => props.output.replace(/\/judger\/run\/[^/"]+\//g, ""))
</script>

<template>
  <CompileErrorExplain v-if="compileError" :err-info="output" :language="language" />
  <n-flex v-else vertical :size="8">
    <RuntimeErrorExplain v-if="runtimeExplain" :info="runtimeError!" :code="code ?? ''" />
    <n-alert v-else type="error" :show-icon="false">{{ message }}</n-alert>
    <n-collapse v-if="rawOutput">
      <n-collapse-item title="原始输出（英文）" name="raw">
        <pre class="raw">{{ rawOutput }}</pre>
      </n-collapse-item>
    </n-collapse>
  </n-flex>
</template>

<style scoped>
.raw {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: Monaco, Consolas, monospace;
  font-size: 13px;
}
</style>
