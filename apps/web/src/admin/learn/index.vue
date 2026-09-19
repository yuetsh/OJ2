<script setup lang="ts">
import { TUTORIAL_READ_SECONDS } from "@oj2/contract"
import { NProgress, NTag, NText } from "naive-ui"
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
// 按学生那张表的姓名/学号搜索，纯前端过滤（整表本来就一次拉完）
const keyword = ref("")

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

type StudentStatus = "idle" | "stalled" | "noPractice" | "going" | "done"

const STALL_DAYS = 7
const STATUS_META: Record<
  StudentStatus,
  { label: string; type: "default" | "error" | "warning" | "info" | "success" }
> = {
  idle: { label: "未开始", type: "error" },
  stalled: { label: `${STALL_DAYS} 天没学`, type: "warning" },
  noPractice: { label: "只读不练", type: "info" },
  going: { label: "进行中", type: "default" },
  done: { label: "已学完", type: "success" },
}

// 一个学生只落进一个状态，按「最需要老师看一眼」的顺序判：
// 没开始 > 学完了 > 停滞 > 只读不练 > 正常推进
function statusOf(row: LearnStudentProgress): StudentStatus {
  if (row.readCount === 0 && row.totalSeconds === 0 && !row.exerciseTried) {
    return "idle"
  }
  if (tutorialCount.value && row.readCount >= tutorialCount.value) return "done"
  if (row.lastViewedAt) {
    // 只比两个时刻相差多少毫秒，不涉及「哪一天」，所以不必走 time.ts 的日历口径
    const days = (Date.now() - Date.parse(row.lastViewedAt)) / 86_400_000
    if (days > STALL_DAYS) return "stalled"
  }
  if (exerciseCount.value && row.readCount > 0 && row.exerciseTried === 0) {
    return "noPractice"
  }
  return "going"
}

const statusFilter = ref<StudentStatus | "all">("all")

const statusCounts = computed(() => {
  const counts: Record<StudentStatus, number> = {
    idle: 0,
    stalled: 0,
    noPractice: 0,
    going: 0,
    done: 0,
  }
  for (const row of students.value) counts[statusOf(row)]++
  return counts
})

const startedCount = computed(
  () => students.value.length - statusCounts.value.idle,
)

const avgRead = computed(() =>
  students.value.length
    ? (
        students.value.reduce((n, row) => n + row.readCount, 0) /
        students.value.length
      ).toFixed(1)
    : "0",
)

// 全班做题的总体正确口径：做对的题数 / 做过的题数
const solveRate = computed(() => {
  const tried = students.value.reduce((n, row) => n + row.exerciseTried, 0)
  const solved = students.value.reduce((n, row) => n + row.exerciseSolved, 0)
  return tried ? Math.round((solved / tried) * 100) : null
})

function lastSeen(value: string | null) {
  if (!value) return "-"
  const days = Math.floor((Date.now() - Date.parse(value)) / 86_400_000)
  const absolute = parseTime(value, "M月D日 HH:mm")
  return days >= 1 ? `${absolute}（${days} 天前）` : absolute
}

// 姓名和学号都已经在手里，不再打接口。学号是纯数字，姓名是中文，
// 一个框同时匹配两列就够了 —— 老师要么记得学号要么记得名字
const filteredStudents = computed(() => {
  const value = keyword.value.trim().toLowerCase()
  return students.value.filter(
    (row) =>
      (statusFilter.value === "all" || statusOf(row) === statusFilter.value) &&
      (!value ||
        row.username.toLowerCase().includes(value) ||
        (row.realName ?? "").toLowerCase().includes(value)),
  )
})

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
    title: "状态",
    key: "status",
    width: 110,
    render: (row) => {
      const meta = STATUS_META[statusOf(row)]
      return h(
        NTag,
        { size: "small", type: meta.type, bordered: false },
        () => meta.label,
      )
    },
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
    width: 210,
    sorter: "default",
    render: (row) => lastSeen(row.lastViewedAt),
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
    {
      type: "expand",
      renderExpand: (row) =>
        h(ExerciseAttempts, {
          exerciseId: row.exerciseId,
          className: className.value.trim(),
        }),
    },
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
      // 试的人不少、却没人一次做对，或者一半以上的人没做对 —— 多半是题有坑，
      // 老师应该先去看展开里全班「最后一次错在」是不是同一个干扰项
      title: "提示",
      key: "flag",
      width: 100,
      render: (row) => {
        if (row.triedUsers < 3) return null
        if (row.firstTryUsers === 0 && row.solvedUsers > 0) {
          return h(
            NTag,
            { size: "small", type: "warning", bordered: false },
            () => "没人一次对",
          )
        }
        if (row.solvedUsers / row.triedUsers < 0.5) {
          return h(
            NTag,
            { size: "small", type: "error", bordered: false },
            () => "多数人卡住",
          )
        }
        return null
      },
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
  statusFilter.value = "all"
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
    <!-- 口径写在表上方，免得老师对着「已读 0 课 / 累计 25 分钟」猜是不是坏了 -->
    <n-text depth="3" style="font-size: 12px">
      「已读」按累计停留满
      {{ TUTORIAL_READ_SECONDS / 60 }} 分钟算，不足的只计时长
    </n-text>
  </n-flex>

  <n-grid
    cols="2 s:3 m:5"
    :x-gap="12"
    :y-gap="12"
    responsive="screen"
    style="margin-bottom: 16px"
  >
    <n-gi>
      <n-card size="small" :bordered="true">
        <n-statistic label="学生" :value="studentCount" />
      </n-card>
    </n-gi>
    <n-gi>
      <n-card size="small">
        <n-statistic label="已开始" :value="startedCount">
          <template #suffix>/ {{ students.length }}</template>
        </n-statistic>
      </n-card>
    </n-gi>
    <n-gi>
      <n-card size="small">
        <n-statistic label="人均已读课数" :value="avgRead">
          <template #suffix>/ {{ tutorialCount }}</template>
        </n-statistic>
      </n-card>
    </n-gi>
    <n-gi>
      <n-card size="small">
        <n-statistic
          label="练一练做对率"
          :value="solveRate === null ? '-' : `${solveRate}%`"
        />
      </n-card>
    </n-gi>
    <n-gi>
      <n-card size="small">
        <n-statistic label="停滞（7 天没学）" :value="statusCounts.stalled">
          <template #suffix>人</template>
        </n-statistic>
      </n-card>
    </n-gi>
  </n-grid>

  <n-tabs v-model:value="tab" type="line" animated>
    <n-tab-pane name="students" tab="按学生">
      <n-flex align="center" style="margin-bottom: 12px">
        <n-input
          v-model:value="keyword"
          placeholder="搜索姓名或学号"
          clearable
          style="width: 200px"
        />
        <n-text v-if="keyword.trim()" depth="3">
          找到 {{ filteredStudents.length }} 人
        </n-text>
      </n-flex>
      <n-flex :size="8" style="margin-bottom: 12px">
        <n-tag
          checkable
          :checked="statusFilter === 'all'"
          @update:checked="statusFilter = 'all'"
        >
          全部 {{ students.length }}
        </n-tag>
        <n-tag
          v-for="(meta, key) in STATUS_META"
          :key="key"
          checkable
          :type="meta.type"
          :checked="statusFilter === key"
          @update:checked="statusFilter = statusFilter === key ? 'all' : key"
        >
          {{ meta.label }} {{ statusCounts[key] }}
        </n-tag>
      </n-flex>
      <n-data-table
        :loading="loading"
        :columns="studentColumns"
        :data="filteredStudents"
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
