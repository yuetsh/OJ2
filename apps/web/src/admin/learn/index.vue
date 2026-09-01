<script setup lang="ts">
import { NProgress, NText } from "naive-ui"
import {
  getLearnStudents,
  getLearnTutorials,
  getLearnExercises,
} from "admin/api"
import { readableDuration, parseTime } from "utils/functions"
import type {
  LearnStudentProgress,
  LearnTutorialProgress,
  LearnExerciseProgress,
} from "utils/types"
import ExerciseAttempts from "./ExerciseAttempts.vue"

const EXERCISE_TYPE_LABEL: Record<string, string> = {
  mcq: "选择",
  sort: "排序",
  fill: "填空",
  match: "连线",
  predict: "预测输出",
  debug: "找错",
  group: "分组",
}

const type = ref<"python" | "c">("python")
// 3-4 位是具体班级，1-2 位当年级前缀（后端 classFilter 分的岔）
const className = ref("")
const tab = ref("students")

const loading = ref(false)
const students = ref<LearnStudentProgress[]>([])
const tutorials = ref<LearnTutorialProgress[]>([])
const exercises = ref<LearnExerciseProgress[]>([])
const tutorialCount = ref(0)
const exerciseCount = ref(0)
const studentCount = ref(0)
// 展开明细的那一行；一次只展开一道题，免得几十个请求一起打出去
const expanded = ref<number[]>([])

const typeOptions = [
  { label: "Python", value: "python" },
  { label: "C 语言", value: "c" },
]

const startedCount = computed(
  () => students.value.filter((row) => row.readCount > 0).length,
)

const studentColumns = computed<DataTableColumn<LearnStudentProgress>[]>(() => [
  { title: "班级", key: "className", width: 90, sorter: "default" },
  { title: "学号", key: "username", width: 140 },
  {
    title: "姓名",
    key: "realName",
    width: 110,
    render: (row) => row.realName || "-",
  },
  {
    title: `已读（共 ${tutorialCount.value} 课）`,
    key: "readCount",
    width: 170,
    sorter: "default",
    // 默认把读得最少的排在最前面：这张表要回答的是「谁还没开始」，
    // 按读得多的排在前面，需要盯的人全在最后一页
    defaultSortOrder: "ascend",
    render: (row) =>
      h("div", { style: "display: flex; align-items: center; gap: 8px" }, [
        h("span", `${row.readCount} / ${tutorialCount.value}`),
        h(NProgress, {
          type: "line",
          percentage: tutorialCount.value
            ? Math.round((row.readCount / tutorialCount.value) * 100)
            : 0,
          showIndicator: false,
          status: row.readCount === 0 ? "error" : "success",
          style: "width: 70px",
        }),
      ]),
  },
  {
    title: `练一练（共 ${exerciseCount.value} 道）`,
    key: "exerciseSolved",
    width: 190,
    sorter: "default",
    render: (row) =>
      h("div", { style: "display: flex; align-items: center; gap: 8px" }, [
        h("span", `${row.exerciseSolved} / ${exerciseCount.value}`),
        // 做过但没做对的题，和提交总次数，一起说明「他在硬啃还是没碰」
        row.exerciseTried > row.exerciseSolved
          ? h(
              NText,
              { depth: 3, style: "font-size: 12px" },
              () => `错 ${row.exerciseTried - row.exerciseSolved} 道`,
            )
          : null,
        row.exerciseAttempts
          ? h(
              NText,
              { depth: 3, style: "font-size: 12px" },
              () => `共 ${row.exerciseAttempts} 次`,
            )
          : null,
      ]),
  },
  {
    title: "累计时长",
    key: "totalSeconds",
    width: 130,
    sorter: "default",
    render: (row) => readableDuration(row.totalSeconds),
  },
  {
    title: "最后学习",
    key: "lastViewedAt",
    width: 170,
    sorter: "default",
    render: (row) =>
      row.lastViewedAt ? parseTime(row.lastViewedAt, "M月D日 HH:mm") : "-",
  },
])

const tutorialColumns = computed<DataTableColumn<LearnTutorialProgress>[]>(
  () => [
    {
      title: "#",
      key: "order",
      width: 60,
      render: (_, index) => index + 1,
    },
    { title: "课程", key: "title", minWidth: 200 },
    {
      title: `读过的人（共 ${studentCount.value} 人）`,
      key: "readers",
      width: 200,
      sorter: "default",
      render: (row) =>
        h("div", { style: "display: flex; align-items: center; gap: 8px" }, [
          h("span", `${row.readers} / ${studentCount.value}`),
          h(NProgress, {
            type: "line",
            percentage: studentCount.value
              ? Math.round((row.readers / studentCount.value) * 100)
              : 0,
            showIndicator: false,
            status: row.readers === 0 ? "error" : "success",
            style: "width: 70px",
          }),
        ]),
    },
    {
      title: "人均时长",
      key: "avgSeconds",
      width: 130,
      sorter: "default",
      render: (row) => readableDuration(row.avgSeconds),
    },
    {
      title: "累计时长",
      key: "totalSeconds",
      width: 130,
      sorter: "default",
      render: (row) => readableDuration(row.totalSeconds),
    },
  ],
)

const exerciseColumns = computed<DataTableColumn<LearnExerciseProgress>[]>(
  () => [
    { type: "expand", renderExpand: (row) => h(ExerciseAttempts, {
      exerciseId: row.exerciseId,
      className: className.value.trim(),
    }) },
    {
      title: "课",
      key: "tutorialOrder",
      width: 160,
      ellipsis: { tooltip: true },
      render: (row) => `${row.tutorialOrder}. ${row.tutorialTitle}`,
    },
    {
      title: "题型",
      key: "type",
      width: 90,
      render: (row) => EXERCISE_TYPE_LABEL[row.type] ?? row.type,
    },
    {
      title: "题干",
      key: "question",
      minWidth: 220,
      ellipsis: { tooltip: true },
      render: (row) => row.question || "（无题干）",
    },
    {
      title: "做对 / 做过",
      key: "solvedUsers",
      width: 150,
      sorter: "default",
      render: (row) =>
        h("div", { style: "display: flex; align-items: center; gap: 8px" }, [
          h("span", `${row.solvedUsers} / ${row.triedUsers}`),
          h(NProgress, {
            type: "line",
            percentage: row.triedUsers
              ? Math.round((row.solvedUsers / row.triedUsers) * 100)
              : 0,
            showIndicator: false,
            status: row.triedUsers === 0 ? "error" : "success",
            style: "width: 60px",
          }),
        ]),
    },
    {
      title: "一次做对",
      key: "firstTryUsers",
      width: 110,
      sorter: "default",
      render: (row) => `${row.firstTryUsers} 人`,
    },
    {
      // 做对的人平均试了几次。它和「一次做对」一起看才分得清难题和歧义题：
      // 平均 3 次但没人一次对 → 题目本身有坑
      title: "平均试几次",
      key: "avgAttemptsToSolve",
      width: 120,
      sorter: "default",
      defaultSortOrder: "descend",
      render: (row) => (row.solvedUsers ? `${row.avgAttemptsToSolve} 次` : "-"),
    },
    {
      title: "提交总次数",
      key: "attempts",
      width: 120,
      sorter: "default",
    },
  ],
)

async function load() {
  loading.value = true
  expanded.value = []
  const params = { type: type.value, className: className.value.trim() }
  try {
    // 三张表一起拉：切 tab 是纯前端的事，不该再等一次网络
    const [studentRes, tutorialRes, exerciseRes] = await Promise.all([
      getLearnStudents(params),
      getLearnTutorials(params),
      getLearnExercises(params),
    ])
    students.value = studentRes.results
    tutorialCount.value = studentRes.tutorialCount
    exerciseCount.value = studentRes.exerciseCount
    tutorials.value = tutorialRes.results
    studentCount.value = tutorialRes.studentCount
    exercises.value = exerciseRes.results
  } finally {
    loading.value = false
  }
}

watch(type, load)
onMounted(load)
</script>

<template>
  <h2 style="margin-top: 0">自学情况</h2>

  <n-flex align="center" style="margin-bottom: 16px">
    <n-radio-group v-model:value="type" size="small">
      <n-radio-button
        v-for="item in typeOptions"
        :key="item.value"
        :value="item.value"
        :label="item.label"
      />
    </n-radio-group>
    <n-input
      v-model:value="className"
      placeholder="班级或年级，如 241 / 24"
      clearable
      style="width: 200px"
      @keyup.enter="load"
      @clear="load"
    />
    <n-button type="primary" secondary @click="load">查询</n-button>
    <n-text depth="3">
      {{ studentCount }} 名学生，{{ startedCount }} 人已经开始学
    </n-text>
  </n-flex>

  <n-tabs v-model:value="tab" type="line" animated>
    <n-tab-pane name="students" tab="按学生">
      <n-data-table
        :loading="loading"
        :columns="studentColumns"
        :data="students"
        :row-key="(row: LearnStudentProgress) => row.userId"
        striped
        :pagination="{ pageSize: 20 }"
      />
    </n-tab-pane>
    <n-tab-pane name="exercises" tab="按练习">
      <n-data-table
        :loading="loading"
        :columns="exerciseColumns"
        :data="exercises"
        :row-key="(row: LearnExerciseProgress) => row.exerciseId"
        v-model:expanded-row-keys="expanded"
        striped
        :pagination="{ pageSize: 20 }"
      />
    </n-tab-pane>
    <n-tab-pane name="tutorials" tab="按课程">
      <n-data-table
        :loading="loading"
        :columns="tutorialColumns"
        :data="tutorials"
        :row-key="(row: LearnTutorialProgress) => row.tutorialId"
        striped
        :pagination="{ pageSize: 20 }"
      />
    </n-tab-pane>
  </n-tabs>
</template>
