<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { RouteLocationRaw } from "vue-router"

/**
 * 后台每一页顶上的那一块：标题行（返回 · 标题 · 标签 ········ 操作按钮），
 * 下面可选一行筛选栏。以前每页各写一份 `.titleWrapper`，筛选控件和「新建」
 * 挤在同一行、左右位置每页不一样，这里统一成一种排法。
 *
 * - `back`：给了就在标题前出一个返回按钮，跳到这个位置（不用 router.back，
 *   从外链直接打开编辑页时没有「上一页」可回）
 * - `#extra`：紧跟标题的小东西（计数 tag 之类）
 * - `#actions`：标题行最右边的按钮，主操作放最后
 * - `#filters`：筛选栏，靠左排
 */
defineProps<{
  title: string
  description?: string
  back?: RouteLocationRaw
}>()

const slots = defineSlots<{
  extra?: () => any
  actions?: () => any
  filters?: () => any
}>()
</script>

<template>
  <div class="pageHeader">
    <div class="row">
      <div class="heading">
        <n-button v-if="back" quaternary circle size="small" @click="$router.push(back)">
          <template #icon><Icon icon="ph:arrow-left" /></template>
        </n-button>
        <h2 class="title">{{ title }}</h2>
        <slot name="extra" />
      </div>
      <div v-if="slots.actions" class="actions">
        <slot name="actions" />
      </div>
    </div>
    <n-text v-if="description" depth="3" class="description">{{ description }}</n-text>
    <div v-if="slots.filters" class="filters">
      <slot name="filters" />
    </div>
  </div>
</template>

<style scoped>
.pageHeader {
  margin-bottom: 16px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  min-height: 34px;
}

.heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.description {
  display: block;
  margin-top: 4px;
  font-size: 13px;
}

.filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 12px;
}
</style>
