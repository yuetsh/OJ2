<script setup lang="ts">
import { NText } from "naive-ui"
import { getLearnExerciseAttempts } from "admin/api"
import { parseTime } from "utils/functions"
import type { LearnExerciseAttempt } from "utils/types"
import UserName from "shared/components/UserName.vue"
import { useBreakpoints } from "shared/composables/breakpoints"

const props = defineProps<{ exerciseId: number; className: string }>()
const { isMobile } = useBreakpoints()

const loading = ref(true)
const rows = ref<LearnExerciseAttempt[]>([])
const untried = ref<{ userId: number; username: string }[]>([])

function renderResult(row: LearnExerciseAttempt) {
  return row.solved
    ? h(NText, { type: "success" }, () => `做对了（第 ${row.attemptsToSolve} 次）`)
    : h(NText, { type: "error" }, () => "还没做对")
}

const desktopColumns: DataTableColumn<LearnExerciseAttempt>[] = [
  // 一个弹框只看一个班，班级列多余；用户名里本来就带名字，不再单列真名
  {
    title: "学生",
    key: "username",
    width: 140,
    render: (row) => h(UserName, { username: row.username }),
  },
  {
    title: "结果",
    key: "solved",
    width: 130,
    render: renderResult,
  },
  { title: "提交次数", key: "attempts", width: 110, sorter: "default" },
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
    width: 120,
    render: (row) => parseTime(row.lastAttemptAt, "M月D日 HH:mm"),
  },
]

/** 手机上五列放不下：一个人一格，名字和结果一行，下面一行小字是交了几次、最后错在哪 */
const mobileColumns: DataTableColumn<LearnExerciseAttempt>[] = [
  {
    title: "学生",
    key: "username",
    render: (row) =>
      h("div", { class: "m-row" }, [
        h("div", { class: "m-line" }, [h(UserName, { username: row.username }), renderResult(row)]),
        h(
          NText,
          { depth: 3, class: "m-sub" },
          () =>
            `交了 ${row.attempts} 次 · ${parseTime(row.lastAttemptAt, "M月D日 HH:mm")}` +
            (row.lastWrongAnswer ? ` · 最后错在 ${row.lastWrongAnswer}` : ""),
        ),
      ]),
  },
]

const columns = computed(() => (isMobile.value ? mobileColumns : desktopColumns))

onMounted(async () => {
  try {
    const data = await getLearnExerciseAttempts(props.exerciseId, {
      className: props.className,
    })
    rows.value = data.results
    untried.value = data.untried
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <n-data-table
    striped
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
  <div v-if="untried.length" class="untried">
    <div class="untried-head">
      <span class="strong">读了这课还没做</span>
      <n-text depth="3">{{ untried.length }} 人</n-text>
    </div>
    <div class="chips">
      <span v-for="row in untried" :key="row.userId" class="chip"
        ><UserName :username="row.username"
      /></span>
    </div>
  </div>
</template>

<style scoped>
.untried {
  margin-top: 16px;
}
.untried-head {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 14px;
}
.strong {
  font-weight: 700;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  height: 26px;
  padding: 0 10px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 13px;
  display: inline-flex;
  align-items: center;
  font-size: 12px;
}
:deep(.m-row) {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
:deep(.m-line) {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
:deep(.m-sub) {
  font-size: 12px;
}
</style>
