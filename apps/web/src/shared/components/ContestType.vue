<script setup lang="ts">
import { ContestType } from "utils/constants"
import type { Contest, OjContest } from "utils/types"

interface Props {
  contest: Contest | OjContest
  size?: "small"
}

const props = defineProps<Props>()

const isPrivate = computed(
  () => props.contest.contestType === ContestType.private,
)
</script>

<template>
  <n-tag :type="isPrivate ? 'error' : 'info'" :size="props.size">
    {{ isPrivate ? "需要密码" : "公开" }}
  </n-tag>
</template>
