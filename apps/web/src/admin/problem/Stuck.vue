<script setup lang="ts">
import { getStuckProblems } from "admin/api"
import type { StuckProblem } from "utils/types"

const loading = ref(true)
const data = ref<StuckProblem[]>([])

const columns: DataTableColumn<StuckProblem>[] = [
  { title: "题目 ID", key: "problemId", width: 100 },
  { title: "题目名称", key: "problemTitle", minWidth: 200 },
  { title: "总提交", key: "total", width: 100, sorter: "default" },
  { title: "失败次数", key: "failed", width: 100, sorter: "default" },
  {
    title: "卡住学生数",
    key: "failedUsers",
    width: 120,
    sorter: "default",
    defaultSortOrder: "descend",
  },
  {
    title: "AC 率",
    key: "acRate",
    width: 100,
    sorter: "default",
    render: (row) => `${row.acRate}%`,
  },
]

onMounted(async () => {
  try {
    const res = await getStuckProblems()
    data.value = res
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <h2 style="margin-top: 0">学生卡点分析（只分析前40道题目）</h2>
  <n-data-table
    :loading="loading"
    :columns="columns"
    :data="data"
    striped
    :pagination="{ pageSize: 20 }"
  />
</template>
