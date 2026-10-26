<script setup lang="ts">
import type { LearningReport } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { statusName } from '../utils'

/** 没通过的提交按结果分；错得最多的那种下面给一个检查办法 */
const props = defineProps<{ errors: LearningReport['errors'] }>()

const theme = useThemeVars()

/** 两个超时码合成一行 */
const rows = computed(() => {
  const merged = new Map<string, number>()
  for (const item of props.errors) {
    const name = statusName(item.result) || '其他'
    merged.set(name, (merged.get(name) ?? 0) + item.count)
  }
  return [...merged].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
})
const total = computed(() => rows.value.reduce((sum, row) => sum + row.count, 0))
const top = computed(() => rows.value[0]?.count ?? 1)

const COLORS: Record<string, string> = { 答案错误: '#d03050', 编译失败: '#e7a33e' }

const TIPS: Record<string, string> = {
  答案错误: '先拿题目里的例子自己跑一遍，输出要和例子一字不差',
  编译失败: '看报错指的是第几行，多半是括号、冒号、引号没配对',
  运行时错误: '看报错说的是第几行、什么错，再回到那一行',
  运行超时: '看看循环能不能停下来',
}
const tip = computed(() => TIPS[rows.value[0]?.name ?? ''])
</script>

<template>
  <section class="card">
    <h3>
      错在哪<small>没通过的 {{ total }} 次</small>
    </h3>
    <div v-for="row in rows" :key="row.name" class="row">
      <span class="name">{{ row.name }}</span>
      <span class="track">
        <span
          class="bar"
          :style="{
            width: `${(row.count / top) * 100}%`,
            background: COLORS[row.name] ?? '#9aa3ad',
          }"
        ></span>
      </span>
      <span class="count">{{ row.count }} 次</span>
    </div>
    <div v-if="tip" class="tip">{{ tip }}</div>
  </section>
</template>

<style scoped>
.card {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  background: v-bind('theme.cardColor');
}

h3 {
  margin: 0;
  font-size: var(--oj-fs-h2);
  display: flex;
  align-items: baseline;
  gap: 8px;
}

h3 small {
  font-size: var(--oj-fs-meta);
  font-weight: 400;
  color: v-bind('theme.textColor3');
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--oj-fs-sec);
}

.name {
  width: 74px;
  flex-shrink: 0;
}

.track {
  flex: 1;
  height: 10px;
  border-radius: 2px 5px 5px 2px;
  background: v-bind('theme.actionColor');
  overflow: hidden;
}

.bar {
  display: block;
  height: 100%;
  min-width: 3px;
  border-radius: 2px 5px 5px 2px;
}

.count {
  width: 52px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.tip {
  padding: 8px 10px;
  border-radius: 6px;
  background: v-bind('theme.actionColor');
  font-size: var(--oj-fs-sec);
  line-height: 22px;
}
</style>
