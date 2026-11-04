<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { storeToRefs } from 'pinia'
import type { RouteLocationRaw } from 'vue-router'
import { getProblemSetDetail, getProblemSetProblems, joinProblemSet } from 'oj/api'
import { useContestStore } from 'oj/store/contest'
import { isFlowchartPass, useFlowchartStore } from 'oj/store/flowchart'
import { useLessonStore } from 'shared/store/lesson'
import { useProblemStore } from 'oj/store/problem'
import { useUserStore } from 'shared/store/user'
import { useBreakpoints } from 'shared/composables/breakpoints'
import { useThemeVars } from 'naive-ui'
import { ContestStatus } from 'utils/constants'
import type { ProblemSet, ProblemSetProblem } from 'utils/types'
import { useProblemPageContext } from '../composables/problemPageContext'
import ProblemChips, { type ChipItem } from './ProblemChips.vue'

/**
 * 左栏顶上的一条：「这道题是从哪来的」。按入口路由决定是哪一种，最多一条：
 *
 * - 课堂：这道题在「班里在做」的列表里 —— 做完几道 + 每道的题号 + 上一题 / 下一题
 * - 专题：专题名 + 进度 + 第几题 + 上一题 / 下一题
 * - 比赛：比赛名 + 每道的题号 + 还剩多久 + 排名
 * - 都不是：不显示
 *
 * 一道题既在这节课里、又是从专题进来的，按入口显示专题条。
 * 换题用的都是普通链接，通过之后欠着的那次强制点评由 SubmissionEffects 的路由守卫拦下。
 */

/** 题多于这个数就横向滚动、去掉 ‹ ›：一节课一般 5 道以内，按 5 道设计 */
const CHIPS_FIT = 5

const ctx = useProblemPageContext()
const { isMobile } = useBreakpoints()
const theme = useThemeVars()
const isDark = useDark()
/** 做完的实心绿圈里的勾：暗色下主题绿很亮，白勾看不清 */
const doneDotText = computed(() => (isDark.value ? 'rgba(0, 0, 0, 0.85)' : '#fff'))

/**
 * 课堂、比赛在电脑上是左边的竖栏（课堂浅绿底、比赛浅黄底），专题是一条不带底色的细横条；
 * 手机上三种都是横条（课堂浅绿、比赛浅黄）。
 * 字色在暗色下换成浅一档的，深绿、深蓝、深黄放在暗底上看不清
 */
const tone = computed(() => ({
  lessonText: isDark.value ? theme.value.primaryColor : theme.value.primaryColorPressed,
  contestText: isDark.value ? '#f2c97d' : '#8a5200',
}))
const userStore = useUserStore()
const { problem } = storeToRefs(useProblemStore())
const currentId = computed(() => problem.value?._id ?? '')

/**
 * 刚在这一页上做出来（不是本来就做过）：代码通过，或者流程图刚评到 A / S。
 * 换题时 id 跟着变，那一次不算；流程图只认这一页上刚评完的（evaluatedSeq）
 */
const flowchartStore = useFlowchartStore()
function onSolvedHere(callback: (step: 'code' | 'draw') => void) {
  watch(
    () => [problem.value?.id, problem.value?.myStatus] as const,
    ([id, status], [previousId, previousStatus]) => {
      if (id !== undefined && id === previousId && status === 0 && previousStatus !== 0) callback('code')
    },
  )
  watch(
    () => flowchartStore.evaluatedSeq,
    () => {
      if (isFlowchartPass(flowchartStore.latestRating.grade)) callback('draw')
    },
  )
}

// ==================== 课堂 ====================
const lessonStore = useLessonStore()

watch(
  () => ctx.value.entry === 'problem' && userStore.isAuthed,
  (want) => {
    // 接口要求登录；没登录就没有这一条
    if (want) lessonStore.load()
  },
  { immediate: true },
)

const lesson = computed(() => {
  if (ctx.value.entry !== 'problem' || !userStore.isAuthed) return null
  const list = lessonStore.activity?.problems ?? []
  const index = list.findIndex((item) => item.problemDisplayId.toLowerCase() === currentId.value.toLowerCase())
  if (index < 0) return null
  const chips: ChipItem[] = list.map((item) => ({
    displayId: item.problemDisplayId,
    title: item.title,
    status: item.myStatus === 'accepted' ? 'done' : item.myStatus === 'tried' ? 'tried' : ('none' as const),
    to: `/problem/${item.problemDisplayId}`,
    note: stepNote(item),
  }))
  return {
    chips,
    done: list.filter((item) => item.myStatus === 'accepted').length,
    total: list.length,
    position: index + 1,
    previous: chips[index - 1]?.to ?? null,
    next: chips[index + 1]?.to ?? null,
  }
})

/**
 * 要画又要写的题（先画再写，或者今天先后布置了画流程图和写代码）：只做到一步时说清楚差哪一步，
 * 光写「做过，还没对」学生会以为是代码错了
 */
function stepNote(item: { draw: string | null; code: string | null; myStatus: string }) {
  if (!item.draw || !item.code || item.myStatus === 'accepted') return undefined
  if (item.draw === 'accepted') return '流程图画对了，还要写代码'
  if (item.code === 'accepted') return '代码做对了，还要画流程图'
  return '先画流程图，再写代码'
}

onSolvedHere((step) => {
  if (ctx.value.entry !== 'problem' || !lessonStore.includes(currentId.value)) return
  lessonStore.markAccepted(currentId.value, step)
  lessonStore.load(true)
})

// ==================== 专题 ====================
const problemSet = ref<ProblemSet | null>(null)
const setProblems = ref<ProblemSetProblem[]>([])

watch(
  () => ctx.value.problemSetId,
  async (id) => {
    problemSet.value = null
    setProblems.value = []
    if (!id) return
    try {
      const [detail, problems] = await Promise.all([getProblemSetDetail(Number(id)), getProblemSetProblems(Number(id))])
      // 拉的这一会儿已经离开了这个专题
      if (ctx.value.problemSetId !== id) return
      problemSet.value = detail
      setProblems.value = problems
    } catch {
      // 拉不到就没有专题条，不影响做题
    }
  },
  { immediate: true },
)

const setBar = computed(() => {
  if (!problemSet.value) return null
  const list = setProblems.value
  const index = list.findIndex((item) => item.problem._id.toLowerCase() === currentId.value.toLowerCase())
  const link = (item: ProblemSetProblem | undefined): RouteLocationRaw | null =>
    item
      ? {
          name: 'problemset problem',
          params: { problemSetId: ctx.value.problemSetId, problemID: item.problem._id },
        }
      : null
  // 进度只数必做题，和专题页的「完成进度 2 / 8（另有 3 道选做）」同一个口径；
  // 一道必做都没有的专题才数全部
  const required = list.some((item) => item.isRequired) ? list.filter((item) => item.isRequired) : list
  const done = required.filter((item) => item.isCompleted).length
  return {
    title: problemSet.value.title,
    joined: problemSet.value.userProgress.isJoined,
    home: { name: 'problemset', params: { problemSetId: ctx.value.problemSetId } },
    done,
    total: required.length,
    percentage: required.length ? (done / required.length) * 100 : 0,
    position: index >= 0 ? index + 1 : null,
    previous: index >= 0 ? link(list[index - 1]) : null,
    next: index >= 0 ? link(list[index + 1]) : null,
  }
})

// 没加入就点进了题（直接打开的链接）：在条上给个「加入」，不然做对了也不记进度
const joiningSet = ref(false)
async function joinHere() {
  const id = ctx.value.problemSetId
  if (!id || joiningSet.value) return
  joiningSet.value = true
  try {
    await joinProblemSet(Number(id))
    problemSet.value = await getProblemSetDetail(Number(id))
  } catch {
    // 加入失败就还是那条提示，回专题页再点一次
  } finally {
    joiningSet.value = false
  }
}

// 判题那一路已经记了账（judge/run.ts），这里只是把这一条就地改掉，不用重拉
onSolvedHere(() => {
  const item = setProblems.value.find((row) => row.problem._id.toLowerCase() === currentId.value.toLowerCase())
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
  if (ctx.value.entry !== 'contest' || !contest || String(contest.id) !== ctx.value.contestId) return null
  const chips: ChipItem[] = contestStore.problems.map((row) => ({
    displayId: row._id,
    title: row.title,
    status: row.status === 'passed' ? 'done' : row.status === 'failed' ? 'tried' : 'none',
    to: `/contest/${ctx.value.contestId}/problem/${row._id}`,
  }))
  return {
    title: contest.title,
    chips,
    remaining: contestStore.remaining,
    // 不在进行中的两种：管理员赛前看题是「还没开始」，不能一律写「已结束」
    notStarted: contestStore.contestStatus === ContestStatus.not_started,
    home: { name: 'contest problems', params: { contestID: ctx.value.contestId } },
    // 期中期末进行中排名不公布，链接也不给
    rank: contestStore.rankHidden ? null : { name: 'contest rank', params: { contestID: ctx.value.contestId } },
  }
})

onSolvedHere(() => {
  const row = contestStore.problems.find((item) => item._id.toLowerCase() === currentId.value.toLowerCase())
  if (row) row.status = 'passed'
})
</script>

<template>
  <!--
    课堂（电脑）：左栏最左边一条竖栏，只写题号，题名鼠标停上去看（学生认题靠题号）。
    不占高度：机房 1366×768 那种屏，顶上每省一行，题面和编辑器就多一行（设计稿「题目页观感」合一版）
  -->
  <nav v-if="lesson && !isMobile" class="lesson-rail" aria-label="这节课的题">
    <div class="rail-head">
      <span>这节课</span>
      <b class="rail-done">{{ lesson.done }}/{{ lesson.total }}</b>
      <span v-if="lessonStore.languageText" class="rail-lang">{{ lessonStore.languageText }}</span>
    </div>
    <router-link
      v-for="(chip, index) in lesson.chips"
      :key="chip.displayId"
      :to="chip.to"
      class="rail-item"
      :class="[chip.status, { current: chip.displayId.toLowerCase() === currentId.toLowerCase() }]"
      :title="chip.note ? `${chip.title}（${chip.note}）` : chip.title"
      :aria-current="chip.displayId.toLowerCase() === currentId.toLowerCase() ? 'page' : undefined"
    >
      <span class="rail-dot">
        <Icon v-if="chip.status === 'done'" icon="ph:check-bold" :width="14" />
        <template v-else>{{ index + 1 }}</template>
      </span>
      <span class="rail-id">{{ chip.displayId }}</span>
    </router-link>
  </nav>

  <!-- 课堂（手机）：一条横的 -->
  <div v-else-if="lesson" class="context-bar lesson">
    <span class="lead lesson-lead"
      >这节课<template v-if="lessonStore.languageText"> · {{ lessonStore.languageText }}</template> 做完 {{ lesson.done }}/{{ lesson.total }}</span
    >
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

  <!-- 专题 -->
  <div v-else-if="setBar" class="context-bar problemset">
    <router-link :to="setBar.home" class="back set-back" :title="`回到专题：${setBar.title}`"> ‹ {{ setBar.title }} </router-link>
    <!-- 手机上一排放不下专题名 + 进度条 + 做完几道 + 两个大箭头，进度条让掉，「做完 x/y」还在 -->
    <div v-if="setBar.joined && !isMobile" class="set-progress" aria-hidden="true">
      <div class="set-progress-fill" :style="{ width: `${setBar.percentage}%` }" />
    </div>
    <span v-if="setBar.joined" class="meta">
      做完 {{ setBar.done }}/{{ setBar.total }}
      <template v-if="setBar.position"> · 第 {{ setBar.position }} 题</template>
    </span>
    <template v-else>
      <span class="meta">{{ isMobile ? '没加入，不算进度' : '还没加入，在这里做对了不算进度' }}</span>
      <n-button size="tiny" type="primary" :loading="joiningSet" @click="joinHere">加入专题</n-button>
    </template>
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

  <!--
    比赛（电脑）：和课堂一样是左边一条竖栏 —— 比赛一般 3 到 10 道题，题号一列摆得下。
    顶上「‹ 比赛」回比赛页（比赛名鼠标停上去看）、还剩多久；底下「排名」（期中期末进行中不给）
  -->
  <nav v-else-if="contestBar && !isMobile" class="lesson-rail contest-rail" aria-label="比赛的题">
    <router-link :to="contestBar.home" class="rail-back" :title="`回到比赛：${contestBar.title}`">
      <Icon icon="ph:caret-left-bold" :width="12" aria-hidden="true" />比赛
    </router-link>
    <div class="rail-head">
      <template v-if="contestBar.remaining">
        <span>还剩</span>
        <b class="rail-time">{{ contestBar.remaining }}</b>
      </template>
      <span v-else>{{ contestBar.notStarted ? '还没开始' : '已结束' }}</span>
    </div>
    <router-link
      v-for="chip in contestBar.chips"
      :key="chip.displayId"
      :to="chip.to"
      class="rail-item"
      :class="[chip.status, { current: chip.displayId.toLowerCase() === currentId.toLowerCase() }]"
      :title="chip.title"
      :aria-current="chip.displayId.toLowerCase() === currentId.toLowerCase() ? 'page' : undefined"
    >
      <!-- 比赛题号本来就短（1、2、A），直接写在圈里；做对了圈涂绿、号还在，认得出是哪道 -->
      <span class="rail-dot">{{ chip.displayId }}</span>
    </router-link>
    <router-link v-if="contestBar.rank" :to="contestBar.rank" class="rail-rank"> <Icon icon="ph:ranking" :width="18" aria-hidden="true" />排名 </router-link>
  </nav>

  <!-- 比赛（手机） -->
  <div v-else-if="contestBar" class="context-bar contest">
    <router-link :to="contestBar.home" class="back contest-back" :title="`回到比赛：${contestBar.title}`"> ‹ {{ contestBar.title }} </router-link>
    <ProblemChips :items="contestBar.chips" :current="currentId" variant="contest" />
    <div class="spacer" />
    <template v-if="contestBar.remaining">
      <span class="meta">还剩</span>
      <span class="countdown">{{ contestBar.remaining }}</span>
    </template>
    <span v-else class="meta">{{ contestBar.notStarted ? '还没开始' : '已结束' }}</span>
    <router-link v-if="contestBar.rank" :to="contestBar.rank" class="contest-rank">排名</router-link>
  </div>
</template>

<style scoped>
/* 比赛竖栏：浅黄底，和课堂分得开 */
.contest-rail {
  background-color: rgba(208, 138, 28, 0.07);
  border-right-color: rgba(208, 138, 28, 0.2);
}

.contest-rail .rail-item:hover {
  background-color: rgba(208, 138, 28, 0.1);
}

.contest-rail .rail-dot {
  font-size: 12px;
  overflow: hidden;
}

.rail-back {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: v-bind('tone.contestText');
  text-decoration: none;
}

.rail-back:hover {
  text-decoration: underline;
}

.rail-time {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: v-bind('tone.contestText');
}

.rail-rank {
  margin-top: auto;
  padding: 8px 0 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: v-bind('theme.textColor2');
  text-decoration: none;
}

.rail-rank:hover {
  color: v-bind('tone.contestText');
}

/* ==================== 课堂竖栏（电脑） ==================== */
.lesson-rail {
  width: 56px;
  flex: none;
  box-sizing: border-box;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  overflow-y: auto;
  scrollbar-width: none;
  background-color: rgba(24, 160, 88, 0.06);
  border-right: 1px solid rgba(24, 160, 88, 0.14);
}

.rail-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 6px;
  font-size: 11px;
  line-height: 1.35;
  color: v-bind('theme.textColor3');
}

.rail-done {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: v-bind('tone.lessonText');
}

.rail-lang {
  max-width: 52px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 7px 0;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: v-bind('theme.textColor2');
  text-decoration: none;
}

.rail-item:hover {
  background-color: rgba(24, 160, 88, 0.08);
}

.rail-item.current {
  font-weight: 700;
  color: v-bind('tone.lessonText');
  background-color: v-bind('theme.bodyColor');
  box-shadow: inset 3px 0 v-bind('theme.primaryColor');
}

.rail-id {
  max-width: 52px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-dot {
  width: 28px;
  height: 28px;
  box-sizing: border-box;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  border: 1.5px solid rgba(128, 128, 128, 0.4);
  background-color: v-bind('theme.bodyColor');
  color: v-bind('theme.textColor2');
}

.done .rail-dot {
  border-color: v-bind('theme.successColor');
  background-color: v-bind('theme.successColor');
  color: v-bind('doneDotText');
}

/* 做过没对：红圈，和题目列表的红「−」一个意思 */
.tried .rail-dot {
  border-color: v-bind('theme.errorColor');
  color: v-bind('theme.errorColor');
}

.current .rail-dot {
  border-width: 2px;
  border-color: v-bind('theme.primaryColor');
  color: v-bind('tone.lessonText');
}

.current.done .rail-dot {
  color: v-bind('doneDotText');
}

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

/* 专题：不带底色的一条细横条（设计稿「题目页观感」合一版）。专题可以有几十道题、还有「加入专题」，
   竖栏放不下，留在页签行上面 */
.problemset {
  height: 40px;
  gap: 10px;
  border-bottom-color: v-bind('theme.dividerColor');
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
  color: v-bind('tone.lessonText');
}

.meta {
  flex: none;
  color: v-bind('theme.textColor2');
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
  color: v-bind('theme.textColor1');
}

/* 比赛名不跟题号那段抢地方：题号多了本来就能横向滚，名字挤成两个字就认不出了 */
.contest-back {
  flex: none;
  max-width: 160px;
  color: v-bind('tone.contestText');
}

.set-progress {
  flex: none;
  width: 110px;
  height: 6px;
  border-radius: 3px;
  background-color: rgba(128, 128, 128, 0.16);
  overflow: hidden;
}

.set-progress-fill {
  height: 100%;
  border-radius: 3px;
  background-color: v-bind('theme.primaryColor');
}

.countdown {
  flex: none;
  font-family: Consolas, Monaco, monospace;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: v-bind('tone.contestText');
}

.contest-rank {
  flex: none;
  color: v-bind('tone.contestText');
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
  color: v-bind('theme.textColor2');
}

.step.big {
  width: 44px;
  height: 44px;
}

.step.forward {
  color: v-bind('tone.lessonText');
}

.problemset .step.forward {
  color: v-bind('theme.textColor1');
}

.step:not(.disabled):hover {
  background-color: rgba(128, 128, 128, 0.1);
}

.step.disabled {
  opacity: 0.3;
}
</style>
