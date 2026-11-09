<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { SubmissionExplain } from '../composables/explain'

/**
 * 「第 9 行：这一行末尾少了分号」那一条，原始报错收在右边的「原始报错」里。
 * 提交列表右栏和独立的提交详情页共用，说法见 composables/explain.ts
 */
const props = defineProps<{
  explain: SubmissionExplain
  tone: { background: string; color: string }
}>()

const rawOpen = ref(false)
// 换了一条就收起来
watch(
  () => props.explain,
  () => (rawOpen.value = false),
)
</script>

<template>
  <div class="explain" :style="{ background: tone.background, borderColor: tone.background }">
    <div class="explain-line">
      <b :style="{ color: tone.color }">
        <template v-if="explain.line">第 {{ explain.line }} 行：</template>{{ explain.text }}
      </b>
      <div class="spacer"></div>
      <n-button v-if="explain.raw" size="tiny" icon-placement="right" class="raw-toggle" @click="rawOpen = !rawOpen">
        <template #icon><Icon :icon="rawOpen ? 'ph:caret-up-bold' : 'ph:caret-down-bold'" /></template>
        原始报错
      </n-button>
    </div>
    <pre v-if="rawOpen && explain.raw" class="raw">{{ explain.raw }}</pre>
  </div>
</template>

<style scoped>
.explain {
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.explain-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  line-height: 1.6;
}

.spacer {
  flex: 1 1 0;
}

.raw-toggle {
  flex: none;
}

.raw {
  margin: 0;
  max-height: 140px;
  overflow: auto;
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
