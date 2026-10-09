<script setup lang="ts">
import type { ContestScoreRow } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { useContestStore } from "oj/store/contest"
import { useTone } from "oj/submission/composables/tone"
import { useUserStore } from "shared/store/user"
import { ContestStatus } from "utils/constants"
import { parseTime, secondsToDuration } from "utils/functions"
import RankMini from "../components/RankMini.vue"

/**
 * 比赛页「题目」（设计稿「比赛重设计」B，用户选的）：一页放下。
 * 左边是题目，每题带几个人做对了、谁最先做对 —— 练习就是要比；
 * 右边是「我」现在第几名、5 分钟里升了几名、再做对 1 道能到第几名、我前后的人。
 * 期中期末进行中右边只剩自己的进度，排名和人数考完公布（后端也不给）
 */
const props = defineProps<{ contestID: string }>()

const contestStore = useContestStore()
const userStore = useUserStore()
const theme = useThemeVars()
const tone = useTone()

const running = computed(() => contestStore.contestStatus === ContestStatus.underway)
const ended = computed(() => contestStore.contestStatus === ContestStatus.finished)

const { pause, resume } = useIntervalFn(
  () => contestStore.loadScoreboard(props.contestID),
  10_000,
  {
    immediate: false,
  },
)
watch(
  () => [contestStore.canEnter, contestStore.contestStatus] as const,
  ([enter, status]) => {
    if (!enter) return
    contestStore.loadScoreboard(props.contestID)
    if (status === ContestStatus.underway) resume()
    else pause()
  },
  { immediate: true },
)

const board = computed(() => contestStore.scoreboard)
const rows = computed(() => board.value?.rows ?? [])
const total = computed(() => rows.value.length)
const me = computed<ContestScoreRow | undefined>(() =>
  rows.value.find((row) => row.userId === userStore.user?.id),
)
/** 排名页、题目条都按题目 id 找格子；题目列表那边是 contestStore.problems（带我的状态） */
const stats = computed(() => new Map((board.value?.problems ?? []).map((p) => [p.id, p])))

function when(seconds: number) {
  const minute = Math.floor(seconds / 60)
  return minute === 0 ? "1 分钟内做对" : `第 ${minute} 分钟做对`
}

const items = computed(() =>
  contestStore.problems.map((problem) => {
    const cell = me.value?.cells[String(problem.id)]
    const stat = stats.value.get(problem.id)
    let mine = ""
    if (cell?.isAc) mine = when(cell.acTime) + (cell.errors ? `，错 ${cell.errors} 次` : "")
    else if (cell) mine = cell.errors ? `交了 ${cell.errors} 次，还没对` : "交过，还没对"
    else if (problem.status === "failed") mine = "交过，还没对"
    return {
      problem,
      done: cell?.isAc || problem.status === "passed",
      tried: !!cell || problem.status === "failed",
      mine,
      solved: stat?.solvedUsers ?? 0,
      first: stat?.firstSolver ?? null,
    }
  }),
)
const solvedCount = computed(() => items.value.filter((item) => item.done).length)

/** 现在再做对一道，按此刻算用时，能排到第几 */
const nextRank = computed(() => {
  if (!running.value) return null
  const elapsed = Math.max(
    0,
    Math.floor((contestStore.now - Date.parse(contestStore.contest!.startTime)) / 1000),
  )
  const solved = (me.value?.solved ?? 0) + 1
  if (solved > contestStore.problems.length) return null
  const time = (me.value?.totalTime ?? 0) + elapsed
  const ahead = rows.value.filter(
    (row) =>
      row.userId !== userStore.user?.id &&
      (row.solved > solved || (row.solved === solved && row.totalTime < time)),
  ).length
  const target = ahead + 1
  return me.value?.rank && target >= me.value.rank ? null : target
})

const move = computed(() => {
  const row = me.value
  if (!row?.rank || !row.prevRank || !running.value) return 0
  return row.prevRank - row.rank
})

const updatedAgo = computed(() => {
  if (!contestStore.scoreboardAt) return ""
  const seconds = Math.max(0, Math.floor((contestStore.now - contestStore.scoreboardAt) / 1000))
  return seconds < 5 ? "刚刚更新" : `${seconds} 秒前更新`
})

function firstMinute(seconds: number) {
  const minute = Math.floor(seconds / 60)
  return minute === 0 ? "不到 1 分" : `${minute} 分`
}

const examLeft = computed(() =>
  items.value.filter((item) => !item.done).map((item) => `第 ${item.problem._id} 题`),
)

const to = (name: string) => ({ name, params: { contestID: props.contestID } })
const success = computed(() => tone("success"))
const warning = computed(() => tone("warning"))
</script>

<template>
  <div class="layout">
    <section class="problems">
      <div class="head">
        <b>题目</b>
        <span class="muted">
          {{ contestStore.problems.length }} 道<template v-if="me || solvedCount">
            · 你做对 {{ solvedCount }} 道</template
          >
        </span>
        <div class="spacer"></div>
        <span v-if="running && !contestStore.rankHidden" class="muted small">做对人数随时更新</span>
      </div>
      <RouterLink
        v-for="item in items"
        :key="item.problem.id"
        :to="`/contest/${contestID}/problem/${item.problem._id}`"
        class="row"
      >
        <span v-if="item.done" class="dot done">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 12l5 5 9-10" />
          </svg>
        </span>
        <span v-else-if="item.tried" class="dot tried" title="交过，还没对">!</span>
        <span v-else class="dot"></span>
        <span class="pid">{{ item.problem._id }}</span>
        <span class="name">{{ item.problem.title }}</span>
        <span class="mine" :class="{ warn: item.tried && !item.done }">{{ item.mine }}</span>
        <template v-if="!contestStore.rankHidden && board">
          <span class="count">
            <span class="track"
              ><span
                class="fill"
                :style="{ width: total ? `${(item.solved / total) * 100}%` : '0' }"
              ></span
            ></span>
            <span class="count-num">{{ item.solved }} 人做对</span>
          </span>
          <span class="first">
            <template v-if="item.first"
              >最先：{{ item.first.username }} · {{ firstMinute(item.first.acTime) }}</template
            >
            <template v-else>还没人做对</template>
          </span>
        </template>
      </RouterLink>
    </section>

    <aside class="side">
      <!-- 期中期末进行中：只有自己的进度 -->
      <template v-if="contestStore.rankHidden">
        <div class="card">
          <div class="big-line">
            <span class="muted small">你做对</span>
            <span class="big">{{ solvedCount }}</span>
            <span class="muted">/ {{ items.length }} 道</span>
          </div>
          <div class="segments">
            <span v-for="item in items" :key="item.problem.id" :class="{ on: item.done }"></span>
          </div>
          <div v-if="examLeft.length" class="small sec">还没做：{{ examLeft.join("、") }}</div>
          <div v-else class="small sec">全做对了，可以再检查一遍</div>
        </div>
        <div class="card lock">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="muted"
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <div class="lock-text">
            <b>{{ contestStore.contest?.tag }}考试，排名考完公布</b>
            <span class="muted small">
              {{ parseTime(contestStore.contest!.endTime, "HH:mm") }}
              结束后这里会出现排名，也能看到每道题有多少人做对。
            </span>
          </div>
        </div>
      </template>

      <template v-else-if="board">
        <div v-if="me && me.rank" class="card">
          <div class="big-line">
            <span class="muted small">{{ ended ? "最后" : "你现在" }}</span>
            <span class="big">第 {{ me.rank }} 名</span>
            <span class="muted">/ {{ total }} 人</span>
            <div class="spacer"></div>
            <span v-if="move > 0" class="move up">5 分钟里上升 {{ move }} 名</span>
            <span v-else-if="move < 0" class="move down">5 分钟里下降 {{ -move }} 名</span>
          </div>
          <div class="small sec">
            做对 <b>{{ me.solved }}</b> 道 · 用时 {{ secondsToDuration(me.totalTime) }}
          </div>
          <div v-if="nextRank" class="nudge">
            再做对 1 道，就能到<b>第 {{ nextRank }} 名</b>
          </div>
          <div v-else-if="running && me.rank === 1" class="nudge">你现在第一，守住</div>
        </div>
        <div v-else-if="running && !contestStore.isTeacher" class="card">
          <b>你还没交题</b>
          <div v-if="nextRank" class="nudge">
            做对 1 道，就能到<b>第 {{ nextRank }} 名</b>
          </div>
        </div>

        <div class="mini">
          <div class="mini-head">
            <b>排名</b>
            <span v-if="running" class="muted small">{{ updatedAgo }}</span>
            <div class="spacer"></div>
            <RouterLink :to="to('contest rank')" class="link">完整排名 ›</RouterLink>
          </div>
          <RankMini :rows="rows" :me="me?.userId" />
          <div v-if="!rows.length" class="muted small empty">还没有人交题</div>
        </div>
        <div class="muted small rule">
          先比做对几道；一样多的，比用时：每道题做对时是第几分钟，加起来；错一次多算 20 分钟。
        </div>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-wrap: wrap;
  min-height: calc(100vh - 140px);
}

.problems {
  flex: 999 1 560px;
  min-width: 0;
  border-right: 1px solid v-bind("theme.dividerColor");
}

.side {
  flex: 1 1 400px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: v-bind("theme.actionColor");
}

@media (min-width: 1100px) {
  .side {
    flex: 0 0 470px;
  }
}

.head {
  height: 40px;
  box-sizing: border-box;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  background: v-bind("theme.actionColor");
}

.spacer {
  flex-grow: 1;
}

.muted {
  color: v-bind("theme.textColor3");
}

.sec {
  color: v-bind("theme.textColor2");
}

.small {
  font-size: 13px;
}

.row {
  min-height: 34px;
  box-sizing: border-box;
  padding: 4px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.row:hover {
  background: v-bind("theme.hoverColor");
}

.dot {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  box-sizing: border-box;
  border-radius: 50%;
  border: 1.5px dashed v-bind("theme.borderColor");
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.dot.done {
  border: 0;
  background: v-bind("theme.successColor");
  color: #ffffff;
}

.dot.tried {
  border: 0;
  background: v-bind("warning.background");
  color: v-bind("warning.color");
  font-size: 13px;
  font-weight: 700;
}

.pid {
  width: 22px;
  text-align: right;
  flex-shrink: 0;
  font-size: 13px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.name {
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mine {
  flex-shrink: 0;
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.mine.warn {
  color: v-bind("warning.color");
}

.count {
  width: 150px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.track {
  width: 64px;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  background: v-bind("theme.dividerColor");
}

.fill {
  background: v-bind("theme.successColor");
  opacity: 0.6;
}

.count-num {
  font-size: 13px;
  color: v-bind("theme.textColor2");
  font-variant-numeric: tabular-nums;
}

.first {
  width: 180px;
  flex-shrink: 0;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
}

.big-line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

.big {
  font-size: 32px;
  font-weight: 800;
  line-height: 1;
  color: v-bind("success.color");
}

.move {
  align-self: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}

.move.up {
  background: v-bind("success.background");
  color: v-bind("success.color");
}

.move.down {
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor3");
}

.nudge {
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 13px;
  background: v-bind("warning.background");
  color: v-bind("warning.color");
}

.segments {
  display: flex;
  gap: 4px;
}

.segments span {
  flex-grow: 1;
  height: 10px;
  border-radius: 2px;
  background: v-bind("theme.dividerColor");
}

.segments span.on {
  background: v-bind("theme.successColor");
}

.lock {
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
}

.lock-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.6;
}

.mini {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mini-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px 6px;
}

.link {
  font-size: 13px;
  color: v-bind("theme.primaryColor");
  text-decoration: none;
}

.empty {
  padding: 8px 2px;
}

.rule {
  line-height: 1.6;
  font-size: 12px;
}

/* 手机：题目名要留得下，人数和「最先」只在右边的排名里看 */
@media (max-width: 760px) {
  .count,
  .first {
    display: none;
  }

  .mine {
    max-width: 45%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
