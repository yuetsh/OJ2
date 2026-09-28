<script setup lang="ts">
import { useMyFlowchartStore } from "shared/store/myFlowchart"
import { useMermaid } from "shared/composables/useMermaid"

/**
 * 学生自己画到 A/S 的那张流程图。题面里是缩略的一小块（compact），点「放大看」弹出整张。
 * 原来是左栏单独一个「我的流程图」页签，评到 A/S 时还会把学生强行切过去。
 */
const props = defineProps<{ compact?: boolean }>()

const store = useMyFlowchartStore()
const { renderError, renderFlowchart } = useMermaid()
const mermaidContainer = useTemplateRef<HTMLElement>("mermaidContainer")

watch(
  () => store.mermaidCode,
  async (code) => {
    if (!code) return
    await nextTick()
    await renderFlowchart(mermaidContainer.value, code)
  },
  { immediate: true },
)
</script>

<template>
  <div>
    <n-alert v-if="renderError" type="error" title="流程图渲染失败" size="small">
      {{ renderError }}
    </n-alert>
    <div
      v-show="!renderError"
      ref="mermaidContainer"
      class="flowchart-container"
      :class="{ compact: props.compact }"
    ></div>
  </div>
</template>

<style scoped>
.flowchart-container {
  width: 100%;
  min-height: 500px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

:deep(.flowchart-container > svg) {
  width: 100%;
  height: auto;
}

.flowchart-container.compact {
  min-height: 0;
  height: 150px;
  align-items: center;
}

/* 缩略图按高度缩：流程图一般是竖长的，按宽度铺满的话 150px 里只看得见开头两个框 */
:deep(.flowchart-container.compact > svg) {
  width: auto;
  max-width: 100%;
  height: 100%;
}
</style>
