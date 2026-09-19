<script setup lang="ts">
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import type { Segment } from "../composables/useExerciseParse"

defineProps<{ segments: Segment[]; lang?: string }>()

const isDark = useDark()
const ExerciseWidget = defineAsyncComponent(
  () => import("./ExerciseWidget.vue"),
)
</script>

<template>
  <template v-for="(seg, i) in segments" :key="i">
    <MdPreview
      v-if="seg.type === 'md'"
      preview-theme="vuepress"
      :theme="isDark ? 'dark' : 'light'"
      :model-value="seg.content"
    />
    <ExerciseWidget v-else :exercise="seg.exercise" :lang="lang" />
  </template>
</template>
