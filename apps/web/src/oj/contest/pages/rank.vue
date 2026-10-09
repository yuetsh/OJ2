<script setup lang="ts">
import type { ContestScoreCell, ContestScoreRow } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { useContestStore } from "oj/store/contest"
import { useTone } from "oj/submission/composables/tone"
import { useUserStore } from "shared/store/user"
import { ContestStatus } from "utils/constants"
import { secondsToDuration } from "utils/functions"
import { classLabel } from "oj/submission/utils"
import UserName from "../components/UserName.vue"

/**
 * 比赛排名（设计稿「比赛重设计」排行榜两块）。竞争感是用户要的（「我需要竞争」）：
 * 名次变化箭头、这题最先做对的深绿格、按班筛、自己那行一直看得见；结束后前三名上领奖台。
 * 原来的前十名排名曲线不要了（用户定的），学生的「导出数据」也拿掉了 —— 导出在老师的成绩页
 */
const props = defineProps<{ contestID: string }>()

const router = useRouter()
const contestStore = useContestStore()
const userStore = useUserStore()
const theme = useThemeVars()
const tone = useTone()

const running = computed(() => contestStore.contestStatus === ContestStatus.underway)
const ended = computed(() => contestStore.contestStatus === ContestStatus.finished)

const autoRefresh = ref(true)
const { pause, resume } = useIntervalFn(
  () => contestStore.loadScoreboard(props.contestID),
  10_000,
  {
    immediate: false,
  },
)
watch(
  () => [contestStore.canEnter, running.value, autoRefresh.value] as const,
  ([enter, run, auto]) => {
    if (!enter) return
    if (!contestStore.scoreboard) contestStore.loadScoreboard(props.contestID)
    if (run && auto) resume()
    else pause()
  },
  { immediate: true },
)
watch(autoRefresh, (on) => on && contestStore.loadScoreboard(props.contestID))

const board = computed(() => contestStore.scoreboard)
const allRows = computed(() => board.value?.rows ?? [])
const problems = computed(() => board.value?.problems ?? [])
const meId = computed(() => userStore.user?.id)
const me = computed(() => allRows.value.find((row) => row.userId === meId.value))

const classFilter = ref("")
const classes = computed(() => {
  const count = new Map<string, number>()
  for (const row of allRows.value) {
    if (row.className) count.set(row.className, (count.get(row.className) ?? 0) + 1)
  }
  return [...count.entries()].sort(([a], [b]) => a.localeCompare(b))
})
const rows = computed(() =>
  classFilter.value
    ? allRows.value.filter((row) => row.className === classFilter.value)
    : allRows.value,
)

const updatedAgo = computed(() => {
  if (!contestStore.scoreboardAt) return ""
  const seconds = Math.max(0, Math.floor((contestStore.now - contestStore.scoreboardAt) / 1000))
  return seconds < 5 ? "刚刚" : `${seconds} 秒前`
})

const podium = computed(() => (ended.value ? allRows.value.slice(0, 3) : []))
/** 我在自己班里第几 */
const classPlace = computed(() => {
  const row = me.value
  if (!row?.className) return null
  return allRows.value.filter((r) => r.className === row.className && r.rank! <= row.rank!).length
})

function move(row: ContestScoreRow) {
  return running.value && row.rank && row.prevRank ? row.prevRank - row.rank : 0
}

function cellOf(row: ContestScoreRow, problemId: number): ContestScoreCell | undefined {
  return row.cells[String(problemId)]
}

function openProblem(displayId: string) {
  router.push(`/contest/${props.contestID}/problem/${displayId}`)
}

const success = computed(() => tone("success"))
const meBackground = computed(
  () =>
    `linear-gradient(${success.value.background}, ${success.value.background}), ${theme.value.cardColor}`,
)
const danger = computed(() => tone("error"))
const columns = computed(
  () =>
    `34px ${running.value ? "34px " : ""}150px 40px 70px repeat(${problems.value.length}, 58px)`,
)
</script>

<template>
  <div v-if="contestStore.rankHidden" class="locked">
    <b>{{ contestStore.contest?.tag }}考试，排名考完公布</b>
    <span class="muted">考完回来就能看到全部名次和每道题的做对情况</span>
  </div>
  <div v-else-if="board" class="rank-page">
    <div v-if="podium.length" class="podium-row">
      <div class="podium">
        <div
          v-for="place in [2, 1, 3]"
          v-show="podium[place - 1]"
          :key="place"
          class="step"
          :class="`p${place}`"
        >
          <svg
            :width="place === 1 ? 26 : 22"
            :height="place === 1 ? 26 : 22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="cup"
          >
            <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
            <path d="M16 6h3v1a3 3 0 0 1-3 3" />
            <path d="M8 6H5v1a3 3 0 0 0 3 3" />
            <path d="M12 13v4" />
            <path d="M8 20h8" />
          </svg>
          <template v-if="podium[place - 1]">
            <UserName
              class="podium-name"
              :username="podium[place - 1]!.username"
              :class-name="podium[place - 1]!.className"
              strong
            />
            <span class="muted small">
              {{ classLabel(podium[place - 1]!.className) }} · {{ podium[place - 1]!.solved }} 道 ·
              {{ secondsToDuration(podium[place - 1]!.totalTime) }}
            </span>
          </template>
          <div class="block">{{ place }}</div>
        </div>
      </div>
      <div class="spacer"></div>
      <div v-if="me" class="mine">
        <span class="muted small">你的成绩</span>
        <div class="mine-line">
          <span class="mine-big">第 {{ me.rank }} 名</span
          ><span class="muted">/ {{ allRows.length }} 人</span>
        </div>
        <span class="small sec">
          做对 {{ me.solved }} 道 · 用时 {{ secondsToDuration(me.totalTime) }}
          <template v-if="classPlace && classes.length > 1">
            · {{ classLabel(me.className) }}里第 {{ classPlace }}</template
          >
        </span>
      </div>
    </div>

    <div class="tools">
      <template v-if="classes.length > 1">
        <button class="chip" :class="{ on: !classFilter }" @click="classFilter = ''">
          全部 {{ allRows.length }}
        </button>
        <button
          v-for="[name, n] in classes"
          :key="name"
          class="chip"
          :class="{ on: classFilter === name }"
          @click="classFilter = name"
        >
          {{ classLabel(name) }} {{ n }}
        </button>
      </template>
      <span v-else class="muted small">{{ allRows.length }} 人</span>
      <div class="spacer"></div>
      <template v-if="running">
        <n-switch v-model:value="autoRefresh" size="small" />
        <span class="small">自动刷新</span>
        <span v-if="autoRefresh" class="muted small">{{ updatedAgo }}</span>
      </template>
    </div>

    <div class="table">
      <div class="tr th" :style="{ gridTemplateColumns: columns }">
        <span class="num">名次</span>
        <span v-if="running"></span>
        <span class="pad">学生</span>
        <span class="num">做对</span>
        <span class="num">用时</span>
        <button
          v-for="p in problems"
          :key="p.id"
          class="ph"
          :title="p.title"
          @click="openProblem(p._id)"
        >
          <b>{{ p._id }}</b>
          <span>{{ p.solvedUsers }} 人</span>
        </button>
      </div>
      <div
        v-for="row in rows"
        :key="row.userId"
        class="tr"
        :class="{ me: row.userId === meId }"
        :style="{ gridTemplateColumns: columns }"
      >
        <span class="num rank">{{ row.rank }}</span>
        <span v-if="running" class="move">
          <span v-if="move(row) > 0" class="up">↑{{ move(row) }}</span>
          <span v-else-if="move(row) < 0" class="down">↓{{ -move(row) }}</span>
        </span>
        <UserName
          class="pad"
          :username="row.username"
          :class-name="row.className"
          :strong="row.userId === meId"
          :title="row.realName ?? row.username"
        />
        <span class="num solved">{{ row.solved }}</span>
        <span class="num time">{{ secondsToDuration(row.totalTime) }}</span>
        <span v-for="p in problems" :key="p.id" class="cell-wrap">
          <template v-if="cellOf(row, p.id)">
            <span
              v-if="cellOf(row, p.id)!.isAc"
              class="cell ac"
              :class="{ first: cellOf(row, p.id)!.firstAc }"
              :title="cellOf(row, p.id)!.firstAc ? '这题最先做对' : undefined"
            >
              {{ Math.floor(cellOf(row, p.id)!.acTime / 60)
              }}<small v-if="cellOf(row, p.id)!.errors">-{{ cellOf(row, p.id)!.errors }}</small>
            </span>
            <span v-else class="cell no">{{
              cellOf(row, p.id)!.errors ? `-${cellOf(row, p.id)!.errors}` : "交过"
            }}</span>
          </template>
        </span>
      </div>
      <div v-if="!rows.length" class="empty muted">还没有人交题</div>
    </div>

    <div class="legend">
      <span><i class="sw first"></i>这题最先做对</span>
      <span><i class="sw ac"></i>做对，格子里是第几分钟（-1 是错过 1 次）</span>
      <span><i class="sw no"></i>还没对，错了几次</span>
      <div class="spacer"></div>
      <span>用时 = 每道做对题的分钟数相加，错一次多算 20 分钟</span>
    </div>
  </div>
</template>

<style scoped>
.locked {
  padding: 80px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-size: 16px;
}

.rank-page {
  display: flex;
  flex-direction: column;
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

.spacer {
  flex-grow: 1;
}

.podium-row {
  padding: 12px 20px 0;
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 20px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.podium {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.step {
  width: 210px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.podium-name {
  font-size: 15px;
  max-width: 200px;
}

.p1 .podium-name {
  font-size: 17px;
}

.block {
  width: 100%;
  box-sizing: border-box;
  padding-top: 6px;
  border-radius: 6px 6px 0 0;
  text-align: center;
  font-size: 22px;
  font-weight: 800;
}

.p1 .cup,
.p1 .block {
  color: #9a6700;
}

.p1 .block {
  height: 66px;
  background: rgba(240, 180, 40, 0.2);
}

.p2 .cup,
.p2 .block {
  color: #5f6b7a;
}

.p2 .block {
  height: 46px;
  background: rgba(120, 135, 155, 0.18);
}

.p3 .cup,
.p3 .block {
  color: #8c5a3c;
}

.p3 .block {
  height: 32px;
  background: rgba(170, 110, 70, 0.16);
}

.mine {
  width: 330px;
  margin-bottom: 16px;
  padding: 14px 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: 6px;
  background: v-bind("success.background");
}

.mine-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.mine-big {
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
  color: v-bind("success.color");
}

.tools {
  min-height: 48px;
  box-sizing: border-box;
  padding: 8px 20px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  border: 1px solid v-bind("theme.borderColor");
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  cursor: pointer;
  white-space: nowrap;
}

.chip.on {
  border-color: transparent;
  background: v-bind("success.background");
  color: v-bind("success.color");
  font-weight: 600;
}

.table {
  max-height: calc(100vh - 230px);
  overflow: auto;
}

.tr {
  display: grid;
  align-items: center;
  column-gap: 6px;
  min-width: max-content;
  height: 32px;
  padding: 0 20px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  background: v-bind("theme.cardColor");
}

.th {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 44px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
}

.tr.me {
  position: sticky;
  bottom: 0;
  top: 44px;
  z-index: 1;
  /* 浅绿是半透明的，钉住时底下的行会透上来，垫一层卡片底色 */
  background: v-bind("meBackground");
  box-shadow: inset 3px 0 0 v-bind("theme.successColor");
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.pad {
  padding-left: 6px;
  min-width: 0;
}

.rank {
  font-weight: 700;
}

.solved {
  font-weight: 700;
}

.time {
  font-size: 12px;
  color: v-bind("theme.textColor3");
  padding-right: 8px;
}

.move {
  font-size: 11px;
}

.up {
  color: v-bind("success.color");
}

.down {
  color: v-bind("danger.color");
}

.ph {
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 16px;
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.ph b {
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.ph span {
  font-size: 11px;
}

.cell-wrap {
  display: flex;
}

.cell {
  width: 100%;
  height: 26px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.cell small {
  font-size: 10px;
  opacity: 0.8;
}

.cell.ac {
  font-weight: 600;
  background: v-bind("success.background");
  color: v-bind("success.color");
}

.cell.ac.first {
  background: v-bind("theme.successColor");
  color: #ffffff;
}

.cell.no {
  background: v-bind("danger.background");
  color: v-bind("danger.color");
}

.empty {
  padding: 24px 20px;
}

.legend {
  min-height: 34px;
  padding: 6px 20px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  border-top: 1px solid v-bind("theme.dividerColor");
}

.legend span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sw {
  width: 28px;
  height: 16px;
  border-radius: 3px;
}

.sw.first {
  background: v-bind("theme.successColor");
}

.sw.ac {
  background: v-bind("success.background");
}

.sw.no {
  background: v-bind("danger.background");
}
</style>
