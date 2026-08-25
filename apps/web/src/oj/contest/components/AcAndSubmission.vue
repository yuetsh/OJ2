<script setup lang="ts">
import type { ContestRank } from "utils/types"

interface Props {
  rank: ContestRank
}
const props = defineProps<Props>()
const router = useRouter()

function goto() {
  router.push({
    name: "contest submissions",
    query: { username: props.rank.user.username },
  })
}
</script>

<template>
  {{ rank.acceptedNumber }} /
  <n-button text type="primary" @click="goto">
    {{ rank.submissionNumber }}
  </n-button>
</template>

<style scoped></style>
