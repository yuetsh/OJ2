<script setup lang="ts">
import { useProblemStore } from "oj/store/problem"
import { useMermaid } from "shared/composables/useMermaid"

const problemStore = useProblemStore()
const { problem } = storeToRefs(problemStore)
const mermaidContainer = useTemplateRef<HTMLElement>("mermaidContainer")

const { renderError, renderFlowchart } = useMermaid()

const renderProblemFlowchart = async () => {
  await renderFlowchart(
    mermaidContainer.value,
    problem.value?.mermaidCode ?? "",
  )
}

onMounted(renderProblemFlowchart)

watch(() => problem.value?.mermaidCode, renderProblemFlowchart)
</script>

<template>
  <div>
    <n-alert v-if="renderError" type="error" title="流程图渲染失败">
      <template #default>
        {{ renderError }}
      </template>
    </n-alert>
    <!-- 容器必须常驻：用 v-else 卸载掉之后 mermaidContainer 变成 null，
         下一次渲染会因为拿不到容器直接 return，图就再也画不出来了 -->
    <div v-show="!renderError" ref="mermaidContainer" class="container"></div>
  </div>
</template>

<style scoped>
.container {
  width: 100%;
  max-width: 100%;
  min-height: 300px;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
