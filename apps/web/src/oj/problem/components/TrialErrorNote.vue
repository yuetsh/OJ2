<script setup lang="ts">
import { SubmissionStatus } from "utils/constants"

/**
 * 试跑（Judge0）没跑完时给学生看的中文说明。Judge0 回来的是英文原文（Traceback、
 * gcc 的报错），学生读不懂，原文收进折叠区。
 */
const props = defineProps<{
  result: SubmissionStatus
  output: string
  language: string
}>()

const message = computed(() => {
  switch (props.result) {
    case SubmissionStatus.compile_error:
      return props.language === "Python"
        ? "代码没能跑起来，写法有错误。按「提交代码」会先检查一遍，告诉你错在哪一行。"
        : "代码没能编译通过，写法有错误。看看是不是漏了分号、括号没配对、变量没声明。"
    case SubmissionStatus.runtime_error:
      return "程序运行到一半出错，停下来了。检查一下输入是怎么读的、下标有没有越界、除数是不是 0。"
    case SubmissionStatus.real_time_limit_exceeded:
      return "运行超时了：程序跑了太久还没结束。看看是不是有死循环，或者在等一个例子里没有的输入。"
    default:
      return "试跑的服务暂时连不上，稍后再试一次。"
  }
})
</script>

<template>
  <n-flex vertical :size="8">
    <n-alert type="error" :show-icon="false">{{ message }}</n-alert>
    <n-collapse v-if="output">
      <n-collapse-item title="原始输出（英文）" name="raw">
        <pre class="raw">{{ output }}</pre>
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
