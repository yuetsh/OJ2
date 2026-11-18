<script setup lang="ts">
import { useThemeVars } from 'naive-ui'

import { labelSwatch } from '../utils/colors'

/**
 * 选一个标签：一排小按钮，点一下就改（画布 TrainStudent 右栏那样）。标签多、字长、一排放不下（加起来超过 16 个字）
 * 才换成下拉 —— 下拉要点两下，改几十条时很烦（11-18 用户提的）。
 * 选中的那个铺上这个标签的颜色。
 */
const props = defineProps<{ labels: string[]; value: string | null }>()
const emit = defineEmits<{ 'update:value': [label: string] }>()
const theme = useThemeVars()

const options = computed(() => props.labels.map((l) => ({ label: l, value: l })))
const asButtons = computed(() => props.labels.join('').length <= 16)
const compact = computed(() => props.labels.length > 3)
</script>

<template>
  <span v-if="asButtons" class="pick" :class="{ compact }" role="group" aria-label="标签">
    <button
      v-for="label in labels"
      :key="label"
      type="button"
      :class="{ on: label === value }"
      :style="label === value ? { background: `${labelSwatch(labels, label)}22`, color: labelSwatch(labels, label) } : undefined"
      :aria-pressed="label === value"
      @click="emit('update:value', label)"
    >
      {{ label }}
    </button>
  </span>
  <n-select v-else :value="value" size="small" :options="options" placeholder="标签" class="select" @update:value="(l: string) => emit('update:value', l)" />
</template>

<style scoped>
.pick {
  display: inline-flex;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}

.pick button {
  height: 28px;
  min-width: 52px;
  padding: 0 8px;
  border: 0;
  border-left: 1px solid v-bind('theme.borderColor');
  background: v-bind('theme.cardColor');
  font: inherit;
  font-size: 13px;
  color: v-bind('theme.textColor3');
  cursor: pointer;
  white-space: nowrap;
}

.pick.compact button {
  min-width: 44px;
  padding: 0 6px;
}

.pick button:first-child {
  border-left: 0;
}

.pick button.on {
  font-weight: 600;
}

.select {
  width: 110px;
}
</style>
