<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { ProblemTypeFilter } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { PROBLEM_TYPE_LABEL } from "../utils/problemType"

/**
 * 几类特殊题的小标签（设计稿「题目列表重设计 · 改版」）。轻重按对学生意味着什么分：
 * - SQL：和画流程图一样重（实心底）—— 写的根本不是 C / Python，点进去之前就得知道
 * - 画流程图：最醒目（浅紫底）—— 只有这类题能交流程图，要做的事和普通题不一样
 * - 语法要求：蓝描边 —— 判题时会检查写法，要看得见
 * - 有参考图：灰描边，最轻 —— 是帮助，不用提醒
 * 都带图标和字，区分不只靠颜色。名字和题目页一致：「语法要求」。
 */
const props = defineProps<{ kind: ProblemTypeFilter }>()

const theme = useThemeVars()

const ICON: Record<ProblemTypeFilter, string> = {
  sql: "ph:database-bold",
  flowchart: "ph:pencil-simple-line-bold",
  ast: "ph:code-bold",
  reference: "ph:flow-arrow-bold",
}

// 明暗两套色都交给 CSS（html.dark），这里只递主题色。**别在这里调 useDark()**：
// 每个实例都会往 <html> 上重写一遍 class、插一段禁用过渡的样式再强制整页重算样式，
// 一页题目十几个标签，切一次知识点就白白重算十几遍（实测占了切换耗时的一大半）
const vars = computed(() => ({
  "--tag-info": theme.value.infoColorPressed,
  "--tag-info-dark": theme.value.infoColor,
  "--tag-muted": theme.value.textColor3,
  "--tag-border": theme.value.borderColor,
}))
</script>

<template>
  <span class="type-tag" :class="kind" :style="vars">
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

/* 主题里没有紫色，两套手配的值，字都压到 4.5:1 以上 */
.type-tag.flowchart {
  font-weight: 600;
  color: #5b2fa6;
  background: #efe8fb;
  border-color: transparent;
}

html.dark .type-tag.flowchart {
  color: #c4adf5;
  background: rgba(160, 120, 240, 0.18);
}

/* 青色：绿 / 橙 / 红是难度、紫是画流程图、蓝是语法要求，剩下它不和谁撞 */
.type-tag.sql {
  font-weight: 600;
  color: #0b6470;
  background: #dcf1f3;
  border-color: transparent;
}

html.dark .type-tag.sql {
  color: #8fd8e0;
  background: rgba(60, 180, 195, 0.18);
}

.type-tag.ast {
  color: var(--tag-info);
  border-color: #b9cdee;
}

html.dark .type-tag.ast {
  color: var(--tag-info-dark);
  border-color: rgba(112, 192, 232, 0.45);
}

.type-tag.reference {
  color: var(--tag-muted);
  border-color: var(--tag-border);
}
</style>
