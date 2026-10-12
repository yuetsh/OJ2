<script setup lang="ts">
import Markdown from "shared/components/Markdown.vue"
import type { LessonSegment } from "../composables/useLessonParse"
import CodeRunBlock from "./CodeRunBlock.vue"

const ExerciseWidget = defineAsyncComponent(() => import("./ExerciseWidget.vue"))

/** 一课的正文：按 useLessonParse 拆好的段落逐段渲染 */
defineProps<{
  segments: LessonSegment[]
  lang: "python" | "c"
  tutorialId: number
  exerciseCount: number
  solvedIds: Set<number>
}>()
const emit = defineEmits<{ solved: [exerciseId: number] }>()

/** 学习目标那几行只有行内的 **加粗** 和 `代码`，先转义再换成标签，别为它拉一整个 Markdown 渲染 */
function inline(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, '<code class="ic">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
}
</script>

<template>
  <div class="body">
    <template v-for="(seg, i) in segments" :key="i">
      <Markdown html v-if="seg.type === 'md'" :content="seg.content" />
      <h2 v-else-if="seg.type === 'heading'" :id="seg.id" class="h2">{{ seg.text }}</h2>
      <div v-else-if="seg.type === 'goals'" :id="seg.id" class="goals">
        <div class="goals-title">学完这课你能</div>
        <div v-for="item in seg.items" :key="item">· <span v-html="inline(item)" /></div>
      </div>
      <CodeRunBlock
        v-else-if="seg.type === 'code'"
        :code="seg.code"
        :lang="seg.lang"
        :tutorial-id="tutorialId"
      />
      <ExerciseWidget
        v-else
        :exercise="seg.exercise"
        :lang="lang"
        :index="seg.index + 1"
        :total="exerciseCount"
        :solved="solvedIds.has(seg.exercise.id)"
        @solved="emit('solved', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.body {
  font-size: 16px;
  line-height: 1.85;
}
.h2 {
  font-size: 20px;
  line-height: 1.4;
  margin: 28px 0 12px;
  scroll-margin-top: 16px;
}
.goals {
  margin: 4px 0 8px;
  padding: 12px 16px;
  border-radius: 6px;
  background: var(--learn-soft);
  font-size: 14px;
  line-height: 1.8;
  scroll-margin-top: 16px;
}
.goals :deep(.ic) {
  font-family: var(--learn-code-font);
  font-size: 13px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--learn-soft);
  color: #c7254e;
}
html.dark .goals :deep(.ic) {
  color: #f08a9b;
}
.goals-title {
  font-weight: 700;
  margin-bottom: 2px;
}
</style>
