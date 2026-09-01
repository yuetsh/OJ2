<script setup lang="ts">
import { NText } from "naive-ui"
import { getLearnExerciseAttempts } from "admin/api"
import { parseTime } from "utils/functions"
import type { LearnExerciseAttempt } from "utils/types"

const props = defineProps<{ exerciseId: number; className: string }>()

const loading = ref(true)
const rows = ref<LearnExerciseAttempt[]>([])

const columns: DataTableColumn<LearnExerciseAttempt>[] = [
  { title: "班级", key: "className", width: 80 },
  { title: "学号", key: "username", width: 140 },
  {
    title: "姓名",
    key: "realName",
    width: 100,
    render: (row) => row.realName || "-",
  },
  {
    title: "结果",
    key: "solved",
    width: 130,
    render: (row) =>
      row.solved
        ? h(
            NText,
            { type: "success" },
            () => `做对了（第 ${row.attemptsToSolve} 次）`,
          )
        : h(NText, { type: "error" }, () => "还没做对"),
  },
  { title: "提交次数", key: "attempts", width: 100, sorter: "default" },
  {
    // 学生最后一次做错时提交的内容，前端拼好的一句人话。选择题看这一列
    // 就知道全班是不是都掉进同一个干扰项
    title: "最后一次错在",
    key: "lastWrongAnswer",
    minWidth: 180,
    ellipsis: { tooltip: true },
    render: (row) => row.lastWrongAnswer || "-",
  },
  {
    title: "最后作答",
    key: "lastAttemptAt",
    width: 150,
    render: (row) => parseTime(row.lastAttemptAt, "M月D日 HH:mm"),
  },
]

onMounted(async () => {
  try {
    rows.value = await getLearnExerciseAttempts(props.exerciseId, {
      className: props.className,
    })
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <n-data-table
    :loading="loading"
    :columns="columns"
    :data="rows"
    size="small"
    :pagination="rows.length > 10 ? { pageSize: 10 } : false"
  />
  <n-empty
    v-if="!loading && rows.length === 0"
    description="还没有人做过这道练习"
    size="small"
    style="padding: 16px 0"
  />
</template>
