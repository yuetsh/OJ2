<script setup lang="ts">
import type { TutorialProgress } from '@oj2/contract'
import { lessonState, splitTitle } from '../lesson'
import LessonDot from './LessonDot.vue'

/** 一课一行：圆点 + 知识点（粗）+ 情境（小字），在学的课右边带练一练做到几道 */
const props = defineProps<{
  title: string
  step: number
  to: string
  progress?: TutorialProgress
  active?: boolean
  /** 行高，首页 48、目录 46、手机 50 */
  height?: number
}>()
const emit = defineEmits<{ go: [] }>()

const parts = computed(() => splitTitle(props.title))
const state = computed(() => lessonState(props.progress))
</script>

<template>
  <router-link :to="to" class="row" :class="{ active }" :style="{ height: `${height ?? 46}px` }" @click="emit('go')">
    <LessonDot :step="step" :state="state" :current="active" />
    <span class="text">
      <span class="kp">{{ parts.kp }}</span>
      <span v-if="parts.scene" class="scene">{{ parts.scene }}</span>
    </span>
    <span v-if="state === 'started' && progress?.exerciseTotal" class="count"> {{ progress.exerciseSolved }}/{{ progress.exerciseTotal }} </span>
  </router-link>
</template>

<style scoped>
.row {
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: inherit;
  text-decoration: none;
}
.row:hover {
  background: var(--learn-soft);
}
.row.active {
  background: var(--learn-green-bg);
}
.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.kp,
.scene {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kp {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}
.active .kp {
  font-weight: 700;
}
.scene {
  font-size: 12px;
  line-height: 16px;
  opacity: 0.55;
}
.count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--learn-orange-text);
  font-variant-numeric: tabular-nums;
}
</style>
