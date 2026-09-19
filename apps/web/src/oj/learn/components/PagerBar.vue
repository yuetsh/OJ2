<script setup lang="ts">
import { useThemeVars } from "naive-ui"

defineProps<{ step: number; total: number }>()
const theme = useThemeVars()
const emit = defineEmits<{ go: [lesson: number] }>()
</script>

<template>
  <nav class="pager" :style="{ background: theme.bodyColor }">
    <n-button secondary :disabled="step <= 1" @click="emit('go', step - 1)">
      ← 上一课
    </n-button>
    <n-text depth="3">{{ step }} / {{ total }}</n-text>
    <n-button
      type="primary"
      :secondary="step >= total"
      :disabled="step >= total"
      @click="emit('go', step + 1)"
    >
      下一课 →
    </n-button>
  </nav>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  margin-top: 16px;
  position: sticky;
  bottom: 0;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
</style>
