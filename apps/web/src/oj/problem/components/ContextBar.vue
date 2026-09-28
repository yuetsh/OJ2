<script setup lang="ts">
import { storeToRefs } from "pinia"
import type { RouteLocationRaw } from "vue-router"
import { getProblemSetDetail, getProblemSetProblems } from "oj/api"
import { useContestStore } from "oj/store/contest"
import { isFlowchartPass, useFlowchartStore } from "oj/store/flowchart"
import { useLessonStore } from "oj/store/lesson"
import { useProblemStore } from "oj/store/problem"
import { useUserStore } from "shared/store/user"
import type { ProblemSet, ProblemSetProblem } from "utils/types"
import { useProblemPageContext } from "../composables/problemPageContext"
import ProblemChips, { type ChipItem } from "./ProblemChips.vue"

/**
 * 左栏顶上的一条：「这道题是从哪来的」。按入口路由决定是哪一种，最多一条：
 *
 * - 课堂：这道题在「班里在做」的列表里 —— 做完几道 + 每道的题号 + 上一题 / 下一题
 * - 题单：题单名 + 进度 + 第几题 + 上一题 / 下一题
 * - 比赛：比赛名 + 每道的题号 + 还剩多久 + 排名
 * - 都不是：不显示
 *
 * 一道题既在这节课里、又是从题单进来的，按入口显示题单条。
 * 换题用的都是普通链接，通过之后欠着的那次强制点评由 SubmissionEffects 的路由守卫拦下。
 */

/** 题多于这个数就横向滚动、去掉 ‹ ›：一节课一般 5 道以内，按 5 道设计 */
const CHIPS_FIT = 5

const ctx = useProblemPageContext()
const userStore = useUserStore()
const { problem } = storeToRefs(useProblemStore())
const currentId = computed(() => problem.value?._id ?? "")

/**
 * 刚在这一页上做出来（不是本来就做过）：代码通过，或者流程图刚评到 A / S。
 * 换题时 id 跟着变，那一次不算；流程图只认这一页上刚评完的（evaluatedSeq）
 */
const flowchartStore = useFlowchartStore()
function onSolvedHere(callback: () => void) {
  watch(
    () => [problem.value?.id, problem.value?.myStatus] as const,
    ([id, status], [previousId, previousStatus]) => {
      if (id !== undefined && id === previousId && status === 0 && previousStatus !== 0) callback()
    },
  )
  watch(
    () => flowchartStore.evaluatedSeq,
    () => {
      if (isFlowchartPass(flowchartStore.latestRating.grade)) callback()
    },
  )
}

// ==================== 课堂 ====================
const lessonStore = useLessonStore()

watch(
  () => ctx.value.entry === "problem" && userStore.isAuthed,
  (want) => {
    // 接口要求登录；没登录就没有这一条
    if (want) lessonStore.load()
  },
  { immediate: true },
)

const lesson = computed(() => {
  if (ctx.value.entry !== "problem" || !userStore.isAuthed) return null
  const list = lessonStore.activity?.problems ?? []
  const index = list.findIndex(
    (item) => item.problemDisplayId.toLowerCase() === currentId.value.toLowerCase(),
  )
  if (index < 0) return null
  const chips: ChipItem[] = list.map((item) => ({
    displayId: item.problemDisplayId,
    title: item.title,
    status:
      item.myStatus === "accepted"
        ? "done"
        : item.myStatus === "tried"
          ? "tried"
          : ("none" as const),
    to: `/problem/${item.problemDisplayId}`,
  }))
  return {
    chips,
    done: list.filter((item) => item.myStatus === "accepted").length,
    total: list.length,
    previous: chips[index - 1]?.to ?? null,
    next: chips[index + 1]?.to ?? null,
  }
})

onSolvedHere(() => {
  if (ctx.value.entry !== "problem" || !lessonStore.includes(currentId.value)) return
  lessonStore.markAccepted(currentId.value)
  lessonStore.load(true)
})

// ==================== 题单 ====================
const problemSet = ref<ProblemSet | null>(null)
const setProblems = ref<ProblemSetProblem[]>([])

watch(
  () => ctx.value.problemSetId,
  async (id) => {
    problemSet.value = null
    setProblems.value = []
    if (!id) return
    try {
      const [detail, problems] = await Promise.all([
        getProblemSetDetail(Number(id)),
        getProblemSetProblems(Number(id)),
      ])
      // 拉的这一会儿已经离开了这个题单
      if (ctx.value.problemSetId !== id) return
      problemSet.value = detail
      setProblems.value = problems
    } catch {
      // 拉不到就没有题单条，不影响做题
    }
  },
  { immediate: true },
)

const setBar = computed(() => {
  if (!problemSet.value) return null
  const list = setProblems.value
  const index = list.findIndex(
    (item) => item.problem._id.toLowerCase() === currentId.value.toLowerCase(),
  )
  const link = (item: ProblemSetProblem | undefined): RouteLocationRaw | null =>
    item
      ? {
          name: "problemset problem",
          params: { problemSetId: ctx.value.problemSetId, problemID: item.problem._id },
        }
      : null
  // 进度只数必做题，和题单页的「完成进度 2 / 8（另有 3 道选做）」同一个口径；
  // 一道必做都没有的题单才数全部
  const required = list.some((item) => item.isRequired)
    ? list.filter((item) => item.isRequired)
    : list
  const done = required.filter((item) => item.isCompleted).length
  return {
    title: problemSet.value.title,
    home: { name: "problemset", params: { problemSetId: ctx.value.problemSetId } },
    done,
    total: required.length,
    percentage: required.length ? (done / required.length) * 100 : 0,
    position: index >= 0 ? index + 1 : null,
    previous: index >= 0 ? link(list[index - 1]) : null,
    next: index >= 0 ? link(list[index + 1]) : null,
  }
})

// 判题那一路已经记了账（judge/run.ts），这里只是把这一条就地改掉，不用重拉
onSolvedHere(() => {
  const item = setProblems.value.find(
    (row) => row.problem._id.toLowerCase() === currentId.value.toLowerCase(),
  )
  if (item) item.isCompleted = true
})

// ==================== 比赛 ====================
const contestStore = useContestStore()

// 比赛页（contest/detail.vue）和比赛题目页是两条并列的路由，不会同时挂着：
// 从比赛页点进来时那边已经 clear 过了，这里自己再拉一遍
// 卸载时路由已经是下一页的了，ctx 里的 contestId 不作数，自己记着
let contestLoaded = false
watch(
  () => ctx.value.contestId,
  (id) => {
    if (!id) return
    contestLoaded = true
    contestStore.init(id).catch(() => {})
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  // 停掉倒计时的表
  if (contestLoaded) contestStore.clear()
})

const contestBar = computed(() => {
  const contest = contestStore.contest
  if (ctx.value.entry !== "contest" || !contest || String(contest.id) !== ctx.value.contestId)
    return null
  const chips: ChipItem[] = contestStore.problems.map((row) => ({
    displayId: row._id,
    title: row.title,
    status: row.status === "passed" ? "done" : row.status === "failed" ? "tried" : "none",
    to: `/contest/${ctx.value.contestId}/problem/${row._id}`,
  }))
  return {
    title: contest.title,
    chips,
    remaining: contestStore.remaining,
    home: { name: "contest problems", params: { contestID: ctx.value.contestId } },
    rank: { name: "contest rank", params: { contestID: ctx.value.contestId } },
  }
})

onSolvedHere(() => {
  const row = contestStore.problems.find(
    (item) => item._id.toLowerCase() === currentId.value.toLowerCase(),
  )
  if (row) row.status = "passed"
})
</script>

<template>
  <!-- 课堂 -->
  <div v-if="lesson" class="context-bar">
    <span class="lead">
      这节课 <b>做完 {{ lesson.done }}/{{ lesson.total }}</b>
    </span>
    <ProblemChips :items="lesson.chips" :current="currentId" />
    <n-button-group v-if="lesson.total <= CHIPS_FIT" size="small" class="steps">
      <n-button :disabled="!lesson.previous" title="上一题" @click="$router.push(lesson.previous!)">
        ‹
      </n-button>
      <n-button :disabled="!lesson.next" title="下一题" @click="$router.push(lesson.next!)">
        ›
      </n-button>
    </n-button-group>
  </div>

  <!-- 题单 -->
  <div v-else-if="setBar" class="context-bar">
    <router-link :to="setBar.home" class="back" :title="`回到题单：${setBar.title}`">
      <span aria-hidden="true">‹</span>
      <span class="name">{{ setBar.title }}</span>
    </router-link>
    <n-progress
      class="set-progress"
      type="line"
      :percentage="setBar.percentage"
      :show-indicator="false"
      :height="6"
      status="success"
    />
    <span class="lead">
      <b>做完 {{ setBar.done }}/{{ setBar.total }}</b>
      <template v-if="setBar.position"> · 第 {{ setBar.position }} 题</template>
    </span>
    <n-button-group size="small" class="steps">
      <n-button :disabled="!setBar.previous" title="上一题" @click="$router.push(setBar.previous!)">
        ‹
      </n-button>
      <n-button :disabled="!setBar.next" title="下一题" @click="$router.push(setBar.next!)">
        ›
      </n-button>
    </n-button-group>
  </div>

  <!-- 比赛 -->
  <div v-else-if="contestBar" class="context-bar">
    <router-link :to="contestBar.home" class="back" :title="`回到比赛：${contestBar.title}`">
      <span aria-hidden="true">‹</span>
      <span class="name">{{ contestBar.title }}</span>
    </router-link>
    <ProblemChips :items="contestBar.chips" :current="currentId" />
    <span v-if="contestBar.remaining" class="lead remaining">
      还剩 <b>{{ contestBar.remaining }}</b>
    </span>
    <span v-else class="lead">已结束</span>
    <router-link :to="contestBar.rank" class="steps">
      <n-button size="small">排名</n-button>
    </router-link>
  </div>
</template>

<style scoped>
.context-bar {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 2px;
  flex: none;
  min-width: 0;
  font-size: 14px;
  white-space: nowrap;
}

.lead {
  flex: none;
}

.remaining b {
  font-variant-numeric: tabular-nums;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  /* 名字不跟题号那段抢地方：题号多了本来就能横向滚，名字挤成两个字就认不出了 */
  flex: none;
  max-width: 160px;
  color: inherit;
  text-decoration: none;
  font-weight: 600;
}

.back:hover {
  text-decoration: underline;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.set-progress {
  flex: 1 1 60px;
  min-width: 40px;
}

.steps {
  flex: none;
  margin-left: auto;
}
</style>
