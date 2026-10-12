<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { LessonState } from "../lesson"

/** 目录里每课前面的圆：学完打勾、在学橙圈、当前绿圈、没开始灰圈 */
defineProps<{ step: number; state: LessonState; current?: boolean }>()
</script>

<template>
  <span class="dot" :class="state === 'done' ? 'done' : current ? 'current' : state">
    <Icon v-if="state === 'done'" icon="ph:check-bold" :width="13" />
    <template v-else>{{ step }}</template>
  </span>
</template>

<style scoped>
.dot {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  box-sizing: border-box;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  border: 1.5px solid var(--learn-todo);
  opacity: 0.9;
}
.done {
  border: 0;
  background: var(--learn-green);
  color: #fff;
  opacity: 1;
}
.started {
  border: 2px solid var(--learn-orange);
  color: var(--learn-orange-text);
  font-weight: 600;
}
.current {
  border: 2px solid var(--learn-green);
  color: var(--learn-green-text);
  font-weight: 700;
  opacity: 1;
}
</style>
