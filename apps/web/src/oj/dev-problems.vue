<script setup lang="ts">
import type { ProblemSummary } from "@oj2/contract"
import { onMounted, ref } from "vue"

const problems = ref<ProblemSummary[]>([])
const error = ref("")

onMounted(async () => {
  try {
    const response = await fetch("/api2/problems")
    const body = await response.json()
    problems.value = body.data
  } catch (cause) {
    error.value = String(cause)
  }
})
</script>

<template>
  <div style="padding: 24px">
    <h2>阶段 1 链路验证（临时页，阶段 3 删除）</h2>
    <p v-if="error" style="color: red">{{ error }}</p>
    <p>共 {{ problems.length }} 道题</p>
    <ul>
      <li v-for="problem in problems" :key="problem.id">
        {{ problem._id }} — {{ problem.title }}（{{ problem.difficulty }}，通过
        {{ problem.acceptedNumber }}/{{ problem.submissionNumber }}）
      </li>
    </ul>
  </div>
</template>
