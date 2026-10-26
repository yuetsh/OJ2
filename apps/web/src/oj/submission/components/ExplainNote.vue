<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import type { SubmissionExplain } from '../composables/explain'

/**
 * 「第 9 行：这一行末尾少了分号」那一条，原始报错收在右边的「原始报错」里。
 * 提交列表右栏和独立的提交详情页共用，说法见 composables/explain.ts
 */
const props = defineProps<{
  explain: SubmissionExplain
  tone: { background: string; color: string }
}>()

const theme = useThemeVars()

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
      <a v-if="explain.raw" href="#" class="raw-toggle" @click.prevent="rawOpen = !rawOpen">
        原始报错
        <Icon :icon="rawOpen ? 'ph:caret-up-bold' : 'ph:caret-down-bold'" :width="11" />
      </a>
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
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: v-bind('theme.primaryColor');
  text-decoration: none;
}

.raw-toggle:hover {
  text-decoration: underline;
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
