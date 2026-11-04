<script setup lang="ts">
import { Icon } from '@iconify/vue'
/**
 * 题面的小节标题：线条图标 + 绿字 + 一根细线拖到头，线尾可以挂一个链接
 * （「自己输入数据试试 ›」「放大看 ›」）。设计稿「题目页观感」⑦，2026-11-04 定。
 *
 * 语法要求、提示用黄色：一个是硬性条件、一个是帮忙的话，扫一眼要能和别的节分开。
 * 明暗两套色都在 CSS 里（html.dark），别在这里调 useDark() —— 理由见 ProblemTypeTag。
 */
export type SectionIcon = 'description' | 'input' | 'output' | 'samples' | 'hint' | 'rules' | 'table' | 'expected' | 'flowchart' | 'similar'

const ICON: Record<SectionIcon, string> = {
  description: 'ph:book-open',
  input: 'ph:sign-in',
  output: 'ph:sign-out',
  samples: 'ph:flask',
  hint: 'ph:lightbulb',
  rules: 'ph:code',
  table: 'ph:table',
  expected: 'ph:check-circle',
  flowchart: 'ph:flow-arrow',
  similar: 'ph:shuffle-angular',
}

const { icon, tone = 'green' } = defineProps<{
  icon: SectionIcon
  tone?: 'green' | 'amber'
}>()
</script>

<template>
  <div class="section-head" :class="tone">
    <h3 class="section-title">
      <Icon :icon="ICON[icon]" :width="19" class="section-icon" aria-hidden="true" />
      <slot />
    </h3>
    <span class="section-line" aria-hidden="true" />
    <span v-if="$slots.extra" class="section-extra"><slot name="extra" /></span>
  </div>
</template>

<style scoped>
.section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 6px;
  --head-text: #0c6b3b;
  --head-icon: #18a058;
  --head-line: rgba(24, 160, 88, 0.22);
}

.section-head.amber {
  --head-text: #8a5a00;
  --head-icon: #c98a00;
  --head-line: rgba(201, 138, 0, 0.25);
}

:global(html.dark) .section-head {
  --head-text: #63e2b7;
  --head-icon: #63e2b7;
  --head-line: rgba(99, 226, 183, 0.22);
}

:global(html.dark) .section-head.amber {
  --head-text: #f2c97d;
  --head-icon: #f2c97d;
  --head-line: rgba(242, 201, 125, 0.25);
}

.section-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 2px;
  white-space: nowrap;
  color: var(--head-text);
}

.section-icon {
  flex: none;
  color: var(--head-icon);
}

.section-line {
  flex: 1 1 auto;
  min-width: 12px;
  height: 1px;
  background-color: var(--head-line);
}

.section-extra {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  white-space: nowrap;
}
</style>
