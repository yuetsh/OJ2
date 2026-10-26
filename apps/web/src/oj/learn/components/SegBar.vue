<script setup lang="ts">
import type { LessonState, ProjectGroup } from '../lesson'

/**
 * 一门课的进度条：一课一小段，按项目分组隔开。绿 = 学完，橙 = 在学，灰 = 没开始，
 * 当前这课描一圈。
 */
defineProps<{
  groups: ProjectGroup[]
  stateOf: (id: number) => LessonState
  current?: number
  /** 每段的宽、高 */
  width?: number
  height?: number
  gap?: number
  groupGap?: number
}>()
</script>

<template>
  <div class="seg" :style="{ gap: `${groupGap ?? 10}px` }" aria-hidden="true">
    <div v-for="group in groups" :key="group.lessons[0]!.id" class="group" :style="{ gap: `${gap ?? 3}px` }">
      <span
        v-for="lesson in group.lessons"
        :key="lesson.id"
        class="cell"
        :class="[stateOf(lesson.id), { current: lesson.id === current }]"
        :style="{
          width: `${width ?? 20}px`,
          height: `${height ?? 6}px`,
          borderRadius: `${(height ?? 6) / 2}px`,
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.seg,
.group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}
.cell {
  flex-shrink: 0;
  background: var(--learn-todo);
}
.cell.done {
  background: var(--learn-green);
}
.cell.started {
  background: var(--learn-orange);
}
.cell.current {
  outline: 2px solid var(--learn-green-text);
  outline-offset: 1px;
}
</style>
