<template>
  <n-flex align="center" :size="8" :wrap="false">
    <n-tag type="error" size="small" v-if="top">置顶</n-tag>
    <span>{{ title }}</span>
  </n-flex>
</template>
<script setup lang="ts">
interface Props {
  top: boolean
  title: string
}

defineProps<Props>()
</script>
