<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { useFlowchartStore } from "oj/store/flowchart"
import { useBreakpoints } from "shared/composables/breakpoints"
import { parseTime } from "utils/functions"

/**
 * 画流程图时工具栏右边那一组：已保存几点、撤销、重做（设计稿 FlowEdB）。
 * 原来这几个和节点库挤在画布右上角的面板里，盖住画好的框；保存状态只是一个 20px 的圆点。
 * 「清空画布」收进了「⋯」。
 */
const { editor, unchanged } = storeToRefs(useFlowchartStore())
const theme = useThemeVars()
// 手机上工具栏挤，「已保存」那几个字不放
const { isDesktop } = useBreakpoints()

const saved = computed(() => {
  // 「交给 AI 点评」灰着的时候说一句为什么（设计稿 FlowResPass）
  if (unchanged.value) return "这一版已点评"
  const at = editor.value?.savedAt
  return at ? `已保存 ${parseTime(at, "HH:mm")}` : ""
})
</script>

<template>
  <div v-if="editor" class="flowchart-controls">
    <span v-if="saved && isDesktop" class="saved">{{ saved }}</span>
    <n-button
      :disabled="!editor.canUndo"
      aria-label="撤销"
      title="撤销（Ctrl+Z）"
      @click="editor.undo()"
    >
      <template #icon>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10a6 6 0 010 12h-3" />
        </svg>
      </template>
    </n-button>
    <n-button
      :disabled="!editor.canRedo"
      aria-label="重做"
      title="重做（Ctrl+Y）"
      @click="editor.redo()"
    >
      <template #icon>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H10a6 6 0 000 12h3" />
        </svg>
      </template>
    </n-button>
  </div>
</template>

<style scoped>
.flowchart-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.saved {
  font-size: 13px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}
</style>
