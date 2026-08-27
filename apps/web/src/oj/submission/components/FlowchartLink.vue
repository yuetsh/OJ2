<template>
  <n-button v-if="flowchart.showLink" type="info" text @click="handleClick">
    {{ flowchart.id.slice(0, 12) }}
  </n-button>
  <!-- 没权限时不能挂 @click：后端 GET /flowcharts/:id 会以 404 挡下，
       前端只会得到一个静默失败的空白面板 -->
  <n-text v-else class="flowchart-id" depth="3">
    {{ flowchart.id.slice(0, 12) }}
  </n-text>
</template>
<script setup lang="ts">
import type { FlowchartSubmissionListItem } from "utils/types"

interface Props {
  flowchart: FlowchartSubmissionListItem
}
const props = defineProps<Props>()

const emit = defineEmits<{
  showDetail: [id: string]
}>()

// showLink 由后端逐行下发（见 routes/flowchart.ts 的 canView），与
// GET /flowcharts/:id 的放行条件同源。原来前端自己按「超管或本人」算了一遍，
// 既漏了教师，也和后端对不上。
function handleClick() {
  emit("showDetail", props.flowchart.id)
}
</script>

<style scoped></style>
