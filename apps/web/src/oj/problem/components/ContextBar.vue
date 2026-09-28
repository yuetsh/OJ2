<script setup lang="ts">
import { storeToRefs } from "pinia"
import type { RouteLocationRaw } from "vue-router"
import { getProblemSetDetail, getProblemSetProblems } from "oj/api"
import { useContestStore } from "oj/store/contest"
import { isFlowchartPass, useFlowchartStore } from "oj/store/flowchart"
import { useLessonStore } from "oj/store/lesson"
import { useProblemStore } from "oj/store/problem"
import { useUserStore } from "shared/store/user"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useThemeVars } from "naive-ui"
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
const { isMobile } = useBreakpoints()
const theme = useThemeVars()
const isDark = useDark()

/**
 * 三种入口各一种底色（设计稿「上下文条与协作状态」）：课堂浅绿、题单浅蓝、比赛浅黄。
 * 字色在暗色下换成浅一档的，深绿、深蓝、深黄放在暗底上看不清
 */
const tone = computed(() => ({
  lessonText: isDark.value ? theme.value.primaryColor : theme.value.primaryColorPressed,
  setText: isDark.value ? "#8fb4ee" : "#1d4f9c",
  setBar: isDark.value ? "#6f9be0" : "#2f6bc4",
  contestText: isDark.value ? "#f2c97d" : "#8a5200",
}))
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
    position: index + 1,
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
  <div v-if="lesson" class="context-bar lesson">
    <span class="lead lesson-lead">这节课 做完 {{ lesson.done }}/{{ lesson.total }}</span>
    <!-- 手机上放不下一排题号：只说是第几道，箭头做大（设计稿「手机：题目 / 代码 / 结果」） -->
    <span v-if="isMobile" class="meta">这是第 {{ lesson.position }} 道</span>
    <ProblemChips v-else :items="lesson.chips" :current="currentId" variant="lesson" />
    <div class="spacer" />
    <template v-if="isMobile || lesson.total <= CHIPS_FIT">
      <component
        :is="lesson.previous ? 'router-link' : 'span'"
        :to="lesson.previous ?? undefined"
        class="step"
        :class="{ disabled: !lesson.previous, big: isMobile }"
        aria-label="上一题"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </component>
      <component
        :is="lesson.next ? 'router-link' : 'span'"
        :to="lesson.next ?? undefined"
        class="step forward"
        :class="{ disabled: !lesson.next, big: isMobile }"
        aria-label="下一题"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </component>
    </template>
  </div>

  <!-- 题单 -->
  <div v-else-if="setBar" class="context-bar problemset">
    <router-link :to="setBar.home" class="back set-back" :title="`回到题单：${setBar.title}`">
      ‹ {{ setBar.title }}
    </router-link>
    <div class="set-progress" aria-hidden="true">
      <div class="set-progress-fill" :style="{ width: `${setBar.percentage}%` }" />
    </div>
    <span class="meta">
      做完 {{ setBar.done }}/{{ setBar.total }}
      <template v-if="setBar.position"> · 第 {{ setBar.position }} 题</template>
    </span>
    <div class="spacer" />
    <component
      :is="setBar.previous ? 'router-link' : 'span'"
      :to="setBar.previous ?? undefined"
      class="step"
      :class="{ disabled: !setBar.previous, big: isMobile }"
      aria-label="上一题"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M15 6l-6 6 6 6" />
      </svg>
    </component>
    <component
      :is="setBar.next ? 'router-link' : 'span'"
      :to="setBar.next ?? undefined"
      class="step forward"
      :class="{ disabled: !setBar.next, big: isMobile }"
      aria-label="下一题"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </component>
  </div>

  <!-- 比赛 -->
  <div v-else-if="contestBar" class="context-bar contest">
    <router-link
      :to="contestBar.home"
      class="back contest-back"
      :title="`回到比赛：${contestBar.title}`"
    >
      ‹ {{ contestBar.title }}
    </router-link>
    <ProblemChips :items="contestBar.chips" :current="currentId" variant="contest" />
    <div class="spacer" />
    <template v-if="contestBar.remaining">
      <span class="meta">还剩</span>
      <span class="countdown">{{ contestBar.remaining }}</span>
    </template>
    <span v-else class="meta">已结束</span>
    <router-link :to="contestBar.rank" class="contest-rank">排名</router-link>
  </div>
</template>

<style scoped>
.context-bar {
  height: 44px;
  flex: none;
  box-sizing: border-box;
  padding: 0 12px 0 20px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
  border-bottom: 1px solid;
}

.lesson {
  background-color: rgba(24, 160, 88, 0.07);
  border-bottom-color: rgba(24, 160, 88, 0.18);
}

.problemset {
  gap: 10px;
  background-color: rgba(47, 107, 196, 0.06);
  border-bottom-color: rgba(47, 107, 196, 0.16);
}

.contest {
  gap: 8px;
  padding-right: 16px;
  background-color: rgba(208, 138, 28, 0.08);
  border-bottom-color: rgba(208, 138, 28, 0.2);
}

.lead {
  flex: none;
  margin-right: 4px;
  font-weight: 600;
}

.lesson-lead {
  color: v-bind("tone.lessonText");
}

.meta {
  flex: none;
  color: v-bind("theme.textColor2");
}

.spacer {
  flex: 1 1 0;
}

.back {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  text-decoration: none;
}

.back:hover {
  text-decoration: underline;
}

.set-back {
  color: v-bind("tone.setText");
}

.contest-back {
  max-width: 160px;
  color: v-bind("tone.contestText");
}

.set-progress {
  flex: none;
  width: 110px;
  height: 6px;
  border-radius: 3px;
  background-color: rgba(47, 107, 196, 0.16);
  overflow: hidden;
}

.set-progress-fill {
  height: 100%;
  border-radius: 3px;
  background-color: v-bind("tone.setBar");
}

.countdown {
  flex: none;
  font-family: Consolas, Monaco, monospace;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: v-bind("tone.contestText");
}

.contest-rank {
  flex: none;
  color: v-bind("tone.contestText");
  text-decoration: none;
}

.contest-rank:hover {
  text-decoration: underline;
}

/* ‹ ›：不带边框的箭头，「下一题」那个上色 */
.step {
  flex: none;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: v-bind("theme.textColor2");
}

.step.big {
  width: 44px;
  height: 44px;
}

.step.forward {
  color: v-bind("tone.lessonText");
}

.problemset .step.forward {
  color: v-bind("tone.setText");
}

.step:not(.disabled):hover {
  background-color: rgba(128, 128, 128, 0.1);
}

.step.disabled {
  opacity: 0.3;
}
</style>
