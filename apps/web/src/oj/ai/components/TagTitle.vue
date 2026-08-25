<template>
  <n-flex vertical align="start">
    <n-flex align="center">
      <n-tag type="info" size="small" :bordered="false">比赛</n-tag>
      <span>{{ problem.contestTitle }}</span>
    </n-flex>
    <span>{{ problem.displayId }} {{ problem.title }}</span>
  </n-flex>
</template>
<script setup lang="ts">
import type { SolvedProblem } from "utils/types"
interface Props {
  problem: SolvedProblem["problem"]
}

const props = defineProps<Props>()
</script>
