<script setup lang="ts">
import SubmissionView from "./components/SubmissionView.vue"

/** 单独打开的一条提交，主体在 SubmissionView（课堂看板「讲错误」的弹层也用它） */
defineProps<{ submissionID: string }>()
</script>

<template>
  <SubmissionView :id="submissionID" />
</template>
