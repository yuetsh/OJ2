<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { ProblemTypeFilter } from "@oj2/contract"
import { useDark } from "@vueuse/core"
import { useThemeVars } from "naive-ui"
import { PROBLEM_TYPE_LABEL } from "../utils/problemType"

/**
 * 三类特殊题的小标签（设计稿「题目列表重设计 · 改版」）。轻重按对学生意味着什么分：
 * - 画流程图：最醒目（浅紫底）—— 只有这类题能交流程图，要做的事和普通题不一样
 * - 语法要求：蓝描边 —— 判题时会检查写法，要看得见
 * - 有参考图：灰描边，最轻 —— 是帮助，不用提醒
 * 都带图标和字，区分不只靠颜色。名字和题目页一致：「语法要求」。
 */
const props = defineProps<{ kind: ProblemTypeFilter }>()

const theme = useThemeVars()
const isDark = useDark()

const ICON: Record<ProblemTypeFilter, string> = {
  flowchart: "ph:pencil-simple-line-bold",
  ast: "ph:code-bold",
  reference: "ph:flow-arrow-bold",
}

const style = computed(() => {
  const t = theme.value
  if (props.kind === "flowchart") {
    // 主题里没有紫色，两套手配的值，字都压到 4.5:1 以上
    return isDark.value
      ? { color: "#c4adf5", background: "rgba(160, 120, 240, 0.18)", borderColor: "transparent" }
      : { color: "#5b2fa6", background: "#efe8fb", borderColor: "transparent" }
  }
  if (props.kind === "ast") {
    return {
      color: isDark.value ? t.infoColor : t.infoColorPressed,
      background: "transparent",
      borderColor: isDark.value ? "rgba(112, 192, 232, 0.45)" : "#b9cdee",
    }
  }
  return { color: t.textColor3, background: "transparent", borderColor: t.borderColor }
})
</script>

<template>
  <span class="type-tag" :class="kind" :style="style">
    <Icon :icon="ICON[props.kind]" :width="12" />{{ PROBLEM_TYPE_LABEL[props.kind] }}
  </span>
</template>

<style scoped>
.type-tag {
  flex: none;
  height: 20px;
  box-sizing: border-box;
  padding: 0 6px 0 5px;
  border: 1px solid;
  border-radius: 3px;
  font-size: 12px;
  line-height: 18px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.type-tag.flowchart {
  font-weight: 600;
}
</style>
