<script setup lang="ts">
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
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

const isDark = useDark()
</script>

<template>
  <div class="body">
    <template v-for="(seg, i) in segments" :key="i">
      <MdPreview
        v-if="seg.type === 'md'"
        preview-theme="vuepress"
        :theme="isDark ? 'dark' : 'light'"
        :model-value="seg.content"
        class="md"
      />
      <h2 v-else-if="seg.type === 'heading'" :id="seg.id" class="h2">{{ seg.text }}</h2>
      <div v-else-if="seg.type === 'goals'" :id="seg.id" class="goals">
        <div class="goals-title">学完这课你能</div>
        <div v-for="item in seg.items" :key="item">· {{ item.replace(/`/g, "") }}</div>
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
  font-size: 15px;
  line-height: 1.85;
}
.md :deep(.md-editor-preview) {
  font-size: 15px;
  padding: 0;
}
.md :deep(.md-editor-preview-wrapper) {
  padding: 0;
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
.goals-title {
  font-weight: 700;
  margin-bottom: 2px;
}
</style>
