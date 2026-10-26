<script setup lang="ts">
import { Icon } from '@iconify/vue'

/** 练一练判完的那一行：对了绿色打勾，错了红字。原来是 n-alert 一整块色条，比题目还抢眼 */
defineProps<{ type: 'success' | 'warning' | 'error'; title: string }>()
</script>

<template>
  <div class="result" :class="type">
    <div class="line">
      <Icon v-if="type === 'success'" icon="ph:check-bold" :width="16" />
      <span>{{ title }}</span>
    </div>
    <div v-if="$slots.default" class="more"><slot /></div>
  </div>
</template>

<style scoped>
.result {
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.6;
}
.line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.success .line {
  color: #18a058;
  font-weight: 600;
}
.warning .line {
  color: var(--learn-orange-text);
}
.error .line {
  color: var(--learn-red-text);
}
.more {
  margin-top: 4px;
  opacity: 0.85;
}
</style>
