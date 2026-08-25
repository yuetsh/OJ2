<script lang="ts" setup>
import type { ProblemFiltered } from "utils/types"
import { Icon } from "@iconify/vue"

defineProps<{
  problem: ProblemFiltered
}>()
</script>
<template>
  <n-flex align="center">
    <span>{{ problem.title }}</span>
    <Icon
      v-if="problem.allowFlowchart"
      width="18"
      icon="vscode-icons:file-type-drawio"
    />
    <Icon
      v-else-if="problem.showFlowchart"
      width="18"
      icon="vscode-icons:file-type-graphql"
    />
    <Icon
      v-if="problem.hasAstRules"
      width="18"
      icon="vscode-icons:file-type-light-todo"
    />
  </n-flex>
</template>
