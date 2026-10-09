<script setup lang="ts">
import { Icon } from "@iconify/vue"

/**
 * 「新建题目」先选题型：编程题和 SQL 题是两张不同的出题页，测试数据的格式也不一样，
 * 建好之后不能互相改（设计稿「SQL 出题页 · 三版共用」）。
 * 每项要两行（名字 + 一句话），n-dropdown 的选项是固定行高，放不下，所以自己画
 */
defineProps<{ label: string; primary?: boolean }>()
const emit = defineEmits<{ select: [kind: "code" | "sql"] }>()

const show = ref(false)

const OPTIONS = [
  {
    kind: "code",
    icon: "ph:code-bold",
    title: "编程题",
    note: "C / C++ / Python，有输入输出说明和样例，也能挂流程图、语法要求",
  },
  {
    kind: "sql",
    icon: "ph:database-bold",
    title: "SQL 题",
    note: "学生写 SQL 查数据库；给几组建表脚本和一条标准答案就行",
  },
] as const

function pick(kind: "code" | "sql") {
  show.value = false
  emit("select", kind)
}
</script>

<template>
  <n-popover
    v-model:show="show"
    trigger="click"
    placement="bottom-end"
    :show-arrow="false"
    style="padding: 6px; width: 340px"
  >
    <template #trigger>
      <n-button :type="primary ? 'primary' : 'default'" icon-placement="right">
        {{ label }}
        <template #icon><Icon icon="ph:caret-down-bold" /></template>
      </n-button>
    </template>
    <div class="menu">
      <button
        v-for="option in OPTIONS"
        :key="option.kind"
        type="button"
        class="option"
        @click="pick(option.kind)"
      >
        <Icon :icon="option.icon" :width="20" class="icon" :class="option.kind" />
        <span class="text">
          <b>{{ option.title }}</b>
          <span class="note">{{ option.note }}</span>
        </span>
      </button>
      <div class="footnote">选好就定了：两种题的测试数据不一样，建好之后不能互相改</div>
    </div>
  </n-popover>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.option:hover,
.option:focus-visible {
  background-color: rgba(128, 128, 128, 0.1);
}

.icon {
  flex: none;
  margin-top: 1px;
}

/*
 * 弹出层挂在 body 下，拿不到这个组件根上 v-bind 出来的主题变量，颜色只能写死
 * （绿和题目页、青和 SQL 标签同一个值）
 */
.icon.code {
  color: #18a058;
}

.icon.sql {
  color: #0b6470;
}

html.dark .icon.sql {
  color: #8fd8e0;
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.note {
  font-size: 12px;
  opacity: 0.65;
}

.footnote {
  margin-top: 4px;
  padding: 8px 12px 4px;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
  font-size: 12px;
  opacity: 0.65;
}
</style>
