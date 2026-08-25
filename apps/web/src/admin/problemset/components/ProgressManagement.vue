<script setup lang="ts">
import { h } from "vue"
import { NDataTable, NButton, NFlex } from "naive-ui"
import { parseTime } from "utils/functions"
import type { AdminProblemSetProgress } from "utils/types"

interface Props {
  progress: AdminProblemSetProgress[]
}

interface Emits {
  (e: "remove-user", userId: number): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

// 定义表格列
const progressColumns = [
  { title: "用户", key: "username", width: 120 },
  {
    title: "加入时间",
    key: "joinTime",
    width: 180,
    render: (row: AdminProblemSetProgress) =>
      parseTime(row.joinTime, "YYYY-MM-DD HH:mm:ss"),
  },
  { title: "已完成", key: "completedProblemsCount", width: 100 },
  { title: "总题目", key: "totalProblemsCount", width: 100 },
  {
    title: "进度",
    key: "progressPercentage",
    width: 100,
    render: (row: AdminProblemSetProgress) =>
      `${row.progressPercentage.toFixed(0)}%`,
  },
  {
    title: "是否完成",
    key: "isCompleted",
    width: 100,
    render: (row: AdminProblemSetProgress) => (row.isCompleted ? "是" : "否"),
  },
  {
    title: "操作",
    key: "actions",
    width: 120,
    render: (row: AdminProblemSetProgress) =>
      h(
        NButton,
        {
          size: "small",
          type: "error",
          secondary: true,
          onClick: () => emit("remove-user", row.userId),
        },
        { default: () => "移除" },
      ),
  },
]
</script>

<template>
  <div>
    <n-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <h3>用户进度</h3>
    </n-flex>
    <n-data-table :columns="progressColumns" :data="progress" />
  </div>
</template>
