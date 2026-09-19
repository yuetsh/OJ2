<script setup lang="ts">
import { TUTORIAL_READ_SECONDS } from "@oj2/contract"
import type { TutorialProgress } from "utils/types"

const props = defineProps<{
  titles: { id: number; title: string }[]
  step: number
  /** 按教程 id 索引的自学留痕，未登录时是空的 */
  progress: Record<number, TutorialProgress>
  /** 是否在留痕（登录了才留） */
  traced: boolean
}>()

const emit = defineEmits<{ select: [lesson: number] }>()

type Status = "todo" | "reading" | "done"

/**
 * 三态：没打开过 / 读过但没读满或练习没做完 / 读满且练习全对。
 * 没有练习的课只看阅读；「已读」的门槛沿用契约的 TUTORIAL_READ_SECONDS。
 */
function statusOf(id: number): Status {
  const p = props.progress[id]
  if (!p?.viewCount) return "todo"
  const read = p.totalSeconds >= TUTORIAL_READ_SECONDS
  const practiced = !p.exerciseTotal || p.exerciseSolved >= p.exerciseTotal
  return read && practiced ? "done" : "reading"
}

function hint(id: number) {
  const p = props.progress[id]
  if (!p?.exerciseTotal) return ""
  return `练一练 ${p.exerciseSolved}/${p.exerciseTotal}`
}
</script>

<template>
  <ol class="lessons">
    <li
      v-for="(item, index) in titles"
      :key="item.id"
      class="lesson"
      :class="{ active: step === index + 1 }"
      @click="emit('select', index + 1)"
    >
      <span class="dot" :class="traced ? statusOf(item.id) : 'todo'">
        <template v-if="traced && statusOf(item.id) === 'done'">✓</template>
        <template v-else>{{ index + 1 }}</template>
      </span>
      <span class="text">
        <span class="title">{{ item.title }}</span>
        <span v-if="traced && hint(item.id)" class="hint">
          {{ hint(item.id) }}
        </span>
      </span>
    </li>
  </ol>
  <n-text v-if="!traced" depth="3" class="login-tip">
    登录后可以记录学习进度
  </n-text>
</template>

<style scoped>
.lessons {
  list-style: none;
  margin: 0;
  padding: 0;
}
.lesson {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s;
}
.lesson:hover {
  background: rgba(128, 128, 128, 0.12);
}
.lesson.active {
  background: rgba(24, 160, 88, 0.14);
}
.dot {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  border: 1.5px solid rgba(128, 128, 128, 0.5);
}
.dot.reading {
  border-color: #f0a020;
  color: #f0a020;
}
.dot.done {
  border-color: #18a058;
  background: #18a058;
  color: #fff;
}
.active .dot.todo {
  border-color: #18a058;
  color: #18a058;
}
.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.title {
  line-height: 1.4;
}
.active .title {
  font-weight: 600;
}
.hint {
  font-size: 12px;
  opacity: 0.6;
}
.login-tip {
  display: block;
  padding: 8px 10px;
}
</style>
