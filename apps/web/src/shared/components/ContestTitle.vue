<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { ContestType } from "utils/constants"
import type { AdminContest, Contest } from "utils/types"

defineProps<{ contest: AdminContest | Contest }>()

const theme = useThemeVars()
</script>
<template>
  <span class="contest-title">
    <span class="text">{{ contest.title }}</span>
    <Icon
      v-if="contest.contestType === ContestType.private"
      icon="ph:lock-simple"
      width="1em"
      class="lock"
      title="要输入密码才能进"
    />
  </span>
</template>
<style scoped>
.contest-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lock {
  flex-shrink: 0;
  color: v-bind("theme.textColor3");
}
</style>
