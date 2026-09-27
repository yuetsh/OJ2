<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { ContestType } from "utils/constants"
import type { AdminContest, Contest } from "utils/types"

defineProps<{ contest: AdminContest | Contest }>()
</script>
<template>
  <n-flex>
    <Icon
      v-if="contest.contestType === ContestType.private"
      :height="24"
      icon="streamline-ultimate-color:shield-lock"
    ></Icon>
    <span>{{ contest.title }}</span>
  </n-flex>
</template>
<style scoped></style>
