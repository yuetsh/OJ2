<script setup lang="ts">
import type {
  ClassBattleItem,
  RankBoard,
  RankPeriod,
  RankRow,
  RankScope,
  WeeklyChampion,
} from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { getClassBattle, getRankBoard, getWeeklyChampions, setRankHidden } from "oj/api"
import { classLabel } from "oj/submission/utils"
import UserName from "shared/components/UserName.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useConfigStore } from "shared/store/config"
import { useUserStore } from "shared/store/user"
import { USERNAME_CLASS_RE } from "utils/constants"
import { parseTime } from "utils/functions"
import ClassBattle from "./components/ClassBattle.vue"
import RankAvatar from "./components/RankAvatar.vue"
import RankMe, { type MiniRank } from "./components/RankMe.vue"
import RankPodium from "./components/RankPodium.vue"
import RankTrack from "./components/RankTrack.vue"
import RankTrend from "./components/RankTrend.vue"
import { useRankPalette } from "./palette"
import {
  groupTitle,
  hottest,
  PERIOD_OPTIONS,
  periodLabel,
  SCOPE_OPTIONS,
  scopeLabel,
} from "./utils"

/**
 * 排名页（设计稿「排名重设计」G1–G3，用户要「激发竞争」「图多」「一眼看出排名」）。
 *
 * 第一屏（机房 1366×768）：领奖台 + 全班赛道，右边是「你」和班级对抗；往下是名次走势、
 * 这周本班、每周冠军。老师不上榜，选班看，每行「⋯」能把怀疑抄代码的学生设成不计入排名。
 */
const router = useRouter()
const route = useRoute()
const message = useMessage()
const dialog = useDialog()
const theme = useThemeVars()
const palette = useRankPalette()
const userStore = useUserStore()
const configStore = useConfigStore()
const { isDesktop } = useBreakpoints()

const teacher = computed(() => userStore.isTeacherOrAbove)
const myClass = computed(() => (teacher.value ? null : userStore.user?.className || null))
/** 本班 / 本年级要有个班：学生看自己的，老师看选中的 */
const canScopeClass = computed(() => teacher.value || !!myClass.value)

function pick<T extends string>(value: unknown, options: { value: T }[], fallback: T): T {
  return options.some((option) => option.value === value) ? (value as T) : fallback
}

const scope = ref<RankScope>("all")
const period = ref<RankPeriod>(pick(route.query.period, PERIOD_OPTIONS, "term"))
/** 老师选的班；空 = 让后端挑最近上课的班，挑完回填 */
const teacherClass = ref(typeof route.query.class === "string" ? route.query.class : "")

const board = ref<RankBoard | null>(null)
const loading = ref(false)
const expanding = ref(false)
const weekBoard = ref<RankBoard | null>(null)
const battle = ref<ClassBattleItem[]>([])
const champions = ref<WeeklyChampion[]>([])
/** 「你」卡底下那几个小名次：别的范围同一时间段的榜，按 key 缓存 */
const cache = reactive(new Map<string, RankBoard>())

function keyOf(s: RankScope, p: RankPeriod) {
  return `${s}|${p}|${s === "all" ? "" : teacherClass.value}`
}

async function fetchBoard(s: RankScope, p: RankPeriod, full = false) {
  const result = await getRankBoard(s, p, { className: teacherClass.value, full })
  if (!full) cache.set(keyOf(s, p), result)
  return result
}

async function load() {
  loading.value = true
  try {
    board.value = await fetchBoard(scope.value, period.value)
    if (teacher.value && !teacherClass.value && board.value.scope !== "all")
      teacherClass.value = board.value.scope === "class" ? (board.value.className ?? "") : ""
  } catch {
    board.value = null
  } finally {
    loading.value = false
  }
  loadSide()
}

/** 班级相关的几块：这周本班、每周冠军；学生的小名次 */
async function loadSide() {
  const cls = classContext.value
  if (cls) {
    getRankBoard("class", "week", { className: teacherClass.value })
      .then((result) => (weekBoard.value = result))
      .catch(() => (weekBoard.value = null))
    getWeeklyChampions(teacherClass.value)
      .then((result) => (champions.value = result))
      .catch(() => (champions.value = []))
  } else {
    weekBoard.value = null
    champions.value = []
  }
  if (!board.value?.me) return
  for (const s of miniScopes.value) {
    if (!cache.has(keyOf(s, period.value))) fetchBoard(s, period.value).catch(() => {})
  }
}

function loadBattle() {
  getClassBattle()
    .then((result) => (battle.value = result))
    .catch(() => {})
}

async function expand() {
  expanding.value = true
  try {
    board.value = await fetchBoard(scope.value, period.value, true)
  } finally {
    expanding.value = false
  }
}

watch([scope, period, teacherClass], () => {
  router.replace({
    query: {
      ...route.query,
      scope: scope.value,
      period: period.value,
      class: teacher.value && teacherClass.value ? teacherClass.value : undefined,
    },
  })
})
watch([scope, period], load)
watch(teacherClass, (value, old) => {
  // 后端回填的那一下（空 → 班号）不用再取一遍
  if (old || !board.value || board.value.className !== value) {
    cache.clear()
    load()
  }
})

onMounted(async () => {
  if (!userStore.user) await userStore.getMyProfile().catch(() => {})
  scope.value = pick(route.query.scope, SCOPE_OPTIONS, canScopeClass.value ? "class" : "all")
  if (!canScopeClass.value && scope.value !== "all") scope.value = "all"
  loadBattle()
  // scope 从 "all" 改成别的会触发 watch 去取；没改就自己取
  if (scope.value === "all") load()
})

/** 班级那几块（走势、这周本班、每周冠军、班级对抗高亮）对的是哪个班 */
const classContext = computed(() => (teacher.value ? teacherClass.value : myClass.value) || null)

const rows = computed(() => board.value?.rows ?? [])
const podium = computed(() => rows.value.filter((row) => row.rank <= 3 && row.solved > 0))
const trackRows = computed(() =>
  rows.value.filter((row) => row.rank > 3 || (row.rank <= 3 && !row.solved)),
)
/** 条的满格：第 2 名的数。第 1 名常常一骑绝尘，按它算别人的条全挤在左边 */
const scale = computed(() => rows.value[1]?.solved || rows.value[0]?.solved || 1)
const hot = computed(() => hottest(rows.value))

const me = computed(() => board.value?.me ?? null)
const meId = computed(() => (teacher.value ? undefined : userStore.user?.id))
const mateClass = computed(() => (board.value?.scope !== "class" ? classContext.value : null))

const title = computed(() =>
  board.value
    ? `${groupTitle(board.value.scope, board.value.className)} · ${periodLabel(board.value.period)}`
    : "",
)
const subtitle = computed(() => {
  const b = board.value
  if (!b) return ""
  const head = b.scope === "class" ? `${b.total} 人` : `${b.total} 人做对过`
  const part = b.complete
    ? ""
    : b.me
      ? " · 前面一段 + 你附近一段"
      : ` · 只列前面 ${b.rows.length} 名`
  return `${head} · 一样多的，先做到的在前${part}`
})
const ruleText = computed(() => {
  const b = board.value
  if (!b) return ""
  const from = b.start ? `${parseTime(b.start, "M月D日")}起` : "全部历史"
  return `${from} · 每道题按第一次做对算 · ↑↓ 比${b.period === "week" ? "今天早上" : "周一"}`
})

const miniScopes = computed(() =>
  SCOPE_OPTIONS.map((option) => option.value).filter(
    (s) => s !== scope.value && (s === "all" || !!myClass.value),
  ),
)
const minis = computed<MiniRank[]>(() => {
  const list: MiniRank[] = []
  if (period.value !== "week" && myClass.value && weekBoard.value)
    list.push({
      label: "这周 · 本班",
      rank: weekBoard.value.me?.solved ? weekBoard.value.me.rank : null,
      total: null,
      go: () => {
        scope.value = "class"
        period.value = "week"
      },
    })
  for (const s of miniScopes.value) {
    const other = cache.get(keyOf(s, period.value))
    list.push({
      label: `${periodLabel(period.value)} · ${scopeLabel(s)}`,
      rank: other?.me?.rank ?? null,
      total: other ? other.total : null,
      go: () => (scope.value = s),
    })
  }
  return list.slice(0, 3)
})

const teacherClassOptions = computed(() => {
  const list = configStore.config?.classList ?? []
  const all =
    teacherClass.value && !list.includes(teacherClass.value) ? [teacherClass.value, ...list] : list
  return all.map((name) => ({ label: classLabel(name), value: name }))
})

const myBattle = computed(() => battle.value.find((item) => item.className === classContext.value))

/** 这周本班：前 5 名（做对过的） */
const weekTop = computed(() =>
  (weekBoard.value?.rows ?? []).filter((row) => row.solved > 0).slice(0, 5),
)
const weekScale = computed(() => weekTop.value[0]?.solved || 1)
const daysLeft = computed(() => {
  const start = weekBoard.value?.start
  if (!start) return 0
  return Math.max(1, Math.ceil((Date.parse(start) + 7 * 86_400_000 - Date.now()) / 86_400_000))
})

/** 走势图三条线：在追你的、你要追的、你（画在最上面） */
const trendLines = computed(() => {
  const b = board.value
  if (!b?.me) return []
  const short = (row: RankRow) =>
    row.user.username.replace(USERNAME_CLASS_RE, "") || row.user.username
  return [
    ...(b.behind
      ? [{ userId: b.behind.user.id, label: short(b.behind), color: palette.value.threat }]
      : []),
    ...(b.ahead
      ? [{ userId: b.ahead.user.id, label: short(b.ahead), color: palette.value.chase }]
      : []),
    { userId: b.me.user.id, label: "你", color: palette.value.me, strong: true },
  ]
})

function open(username: string) {
  router.push({ path: "/user", query: { name: username } })
}

function openSubmissions(username: string) {
  router.push({ path: "/submission", query: { username, exactUsername: "1" } })
}

function hide(row: RankRow) {
  dialog.warning({
    title: "不计入排名",
    content: `${row.user.username} 会从所有排名里消失（本班、本年级、全服、首页周榜），他自己会看到「不计入排名」。比赛排名不受影响，随时能恢复。`,
    positiveText: "不计入排名",
    negativeText: "取消",
    onPositiveClick: async () => {
      await setRankHidden(row.user.id, true)
      message.success("已不计入排名")
      cache.clear()
      load()
      loadBattle()
    },
  })
}

async function restore(userId: number) {
  await setRankHidden(userId, false)
  message.success("已恢复")
  cache.clear()
  load()
  loadBattle()
}

function weekLabel(start: string) {
  return `${parseTime(start, "M月D日")}那周`
}
</script>

<template>
  <div class="rank-page">
    <div class="toolbar">
      <h2>排名</h2>
      <div class="seg" role="group" aria-label="范围">
        <button
          v-for="option in SCOPE_OPTIONS"
          :key="option.value"
          :class="{ on: scope === option.value }"
          :disabled="option.value !== 'all' && !canScopeClass"
          :title="option.value !== 'all' && !canScopeClass ? '没有班级，只能看全服' : undefined"
          @click="scope = option.value"
        >
          {{ option.label }}
        </button>
      </div>
      <div class="seg" role="group" aria-label="时间">
        <button
          v-for="option in PERIOD_OPTIONS"
          :key="option.value"
          :class="{ on: period === option.value }"
          @click="period = option.value"
        >
          {{ option.label }}
        </button>
      </div>
      <n-select
        v-if="teacher && scope !== 'all'"
        v-model:value="teacherClass"
        class="class-select"
        size="small"
        filterable
        placeholder="选班"
        :options="teacherClassOptions"
      />
      <div class="spacer" />
      <span class="rule">{{ ruleText }}</span>
    </div>

    <div class="main" :class="{ single: !isDesktop }">
      <n-spin :show="loading" class="track-card">
        <template v-if="board">
          <div class="card-head">
            <b>{{ title }}</b>
            <span class="muted">{{ subtitle }}</span>
            <div class="spacer" />
            <span v-if="!teacher && me" class="legend">
              <span><i :style="{ background: palette.me }" />你</span>
              <span v-if="board.ahead"><i :style="{ background: palette.chase }" />你要追的</span>
              <span v-if="board.behind"><i :style="{ background: palette.threat }" />在追你的</span>
              <span v-if="mateClass"><i :style="{ background: palette.mate }" />你们班</span>
            </span>
          </div>
          <RankPodium
            :rows="podium"
            :me-id="meId"
            :chase-id="board.ahead?.user.id"
            :threat-id="board.behind?.user.id"
            @open="open"
          />
          <RankTrack
            :rows="trackRows"
            :total="board.total"
            :complete="board.complete"
            :scale="scale"
            :me-id="meId"
            :chase-id="board.ahead?.user.id"
            :threat-id="board.behind?.user.id"
            :hot-id="hot?.user.id"
            :mate-class="mateClass"
            :teacher="teacher"
            :expanding="expanding"
            @open="open"
            @expand="expand"
            @submissions="openSubmissions"
            @hide="hide"
          />
        </template>
        <div v-else-if="!loading" class="empty">排名没取到，刷新一下试试</div>
      </n-spin>

      <aside class="side">
        <template v-if="board">
          <RankMe
            v-if="me"
            :me="me"
            :ahead="board.ahead"
            :behind="board.behind"
            :third="me.rank > 3 ? (podium[2] ?? null) : null"
            :total="board.total"
            :label="`${scopeLabel(board.scope)} · ${periodLabel(board.period)}`"
            :minis="minis"
          />
          <div v-else-if="board.hidden" class="note-card">
            <b>你现在不计入排名</b>
            <span class="muted">老师把你从排名里拿掉了，榜上看不到你。有疑问去问老师。</span>
          </div>
          <div v-else-if="teacher" class="note-card">
            <b>{{ classContext ? classLabel(classContext) : "全服" }}</b>
            <div v-if="myBattle" class="stats">
              <div>
                <span>人均做对</span><b>{{ myBattle.perCapita }}</b>
              </div>
              <div>
                <span>班级对抗</span><b>第 {{ myBattle.rank }}</b>
              </div>
              <div>
                <span>这周人均涨</span><b>+{{ myBattle.weekGain }}</b>
              </div>
            </div>
            <div class="hidden-list">
              <span class="hidden-title">不计入排名的人</span>
              <template v-if="board.scope === 'class'">
                <div v-for="user in board.hiddenUsers" :key="user.id" class="hidden-row">
                  <UserName :username="user.username" />
                  <n-button size="tiny" secondary @click="restore(user.id)">恢复</n-button>
                </div>
                <span v-if="!board.hiddenUsers.length" class="muted">
                  还没有。怀疑抄代码的，在名单上点「⋯」拿掉。
                </span>
              </template>
              <span v-else class="muted">切到「本班」看这个班拿掉了谁</span>
            </div>
          </div>
          <div v-else-if="userStore.isAuthed" class="note-card">
            <b>{{ periodLabel(board.period) }}你还没上榜</b>
            <span class="muted">做对 1 道新题就能上榜</span>
          </div>
        </template>
        <ClassBattle v-if="isDesktop" :items="battle" :mine="classContext" :teacher="teacher" />
      </aside>
    </div>
    <!-- 手机上「你」那张卡提到赛道前面了，班级对抗放到赛道后面，别把赛道挤到第三屏 -->
    <ClassBattle v-if="!isDesktop" :items="battle" :mine="classContext" :teacher="teacher" />

    <div v-if="classContext" class="below" :class="{ single: !isDesktop }">
      <div v-if="board?.trend && me" class="card">
        <div class="card-title">
          <b>我和对手的名次</b><span class="muted">每周日晚上 · 越高越好</span>
        </div>
        <RankTrend :trend="board.trend" :lines="trendLines" />
      </div>
      <div class="card">
        <div class="card-title">
          <b>{{ teacher && classContext ? `这周 · ${classLabel(classContext)}` : "这周本班" }}</b>
          <span class="muted">还剩 {{ daysLeft }} 天 · 下周一清零</span>
        </div>
        <div
          v-for="row in weekTop"
          :key="row.user.id"
          class="week-row"
          :class="{ me: row.user.id === meId }"
        >
          <span
            class="medal"
            :style="
              row.rank <= 3
                ? {
                    color: palette.medal[row.rank - 1]!.color,
                    background: palette.medal[row.rank - 1]!.background,
                  }
                : undefined
            "
            >{{ row.rank }}</span
          >
          <RankAvatar
            :username="row.user.username"
            :avatar="row.avatar"
            :size="18"
            :me="row.user.id === meId"
          />
          <button class="who" @click="open(row.user.username)">
            <UserName :username="row.user.username" />
          </button>
          <span class="bar-box">
            <span
              class="bar"
              :style="{
                width: `${(row.solved / weekScale) * 100}%`,
                background: row.user.id === meId ? palette.me : palette.bar,
              }"
            />
          </span>
          <b class="num">{{ row.solved }}</b>
        </div>
        <span v-if="weekBoard && !weekTop.length" class="muted">
          这周还没人做对新题，现在做对 1 道就是第一
        </span>
      </div>
      <div class="card">
        <div class="card-title">
          <b>每周冠军</b><span class="muted">本班 · 每周一清零后重新比</span>
        </div>
        <div v-for="champion in champions" :key="champion.weekStart" class="champion">
          <span class="muted week">{{ weekLabel(champion.weekStart) }}</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="#f2c94c"
            stroke="#9a6700"
            stroke-width="1.6"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
          </svg>
          <RankAvatar
            :username="champion.user.username"
            :avatar="champion.avatar"
            :size="20"
            :me="champion.user.id === meId"
          />
          <button class="who" @click="open(champion.user.username)">
            <UserName :username="champion.user.username" />
          </button>
          <span class="muted num">{{ champion.solved }} 道</span>
        </div>
        <span v-if="!champions.length" class="muted">最近几周还没有冠军</span>
        <div v-if="hot" class="champion hot-line">
          <span class="hot-tag">冲得最猛</span>
          <RankAvatar
            :username="hot.user.username"
            :avatar="hot.avatar"
            :size="20"
            :me="hot.user.id === meId"
          />
          <button class="who" @click="open(hot.user.username)">
            <UserName :username="hot.user.username" />
          </button>
          <span class="muted"
            >{{ period === "week" ? "今天" : "这周" }}升了 {{ hot.change }} 名</span
          >
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rank-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar h2 {
  margin: 0;
  font-size: 20px;
}

.seg {
  display: inline-flex;
  height: 30px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 4px;
  overflow: hidden;
}

.seg button {
  padding: 0 12px;
  border: 0;
  border-left: 1px solid v-bind("theme.borderColor");
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor2");
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.seg button:first-child {
  border-left: 0;
}

.seg button.on {
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
  font-weight: 600;
}

.seg button:disabled {
  color: v-bind("theme.textColorDisabled");
  cursor: not-allowed;
}

.class-select {
  width: 150px;
}

.spacer {
  flex-grow: 1;
}

.rule,
.muted {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: 16px;
  align-items: start;
}

.main.single,
.below.single {
  grid-template-columns: minmax(0, 1fr);
}

/* 手机上「你」那张卡放到赛道前面，不然要划过全班才看得到自己 */
.main.single .side {
  order: -1;
}

.track-card,
.card,
.note-card {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
  min-width: 0;
}

.track-card {
  min-height: 300px;
}

.card-head {
  min-height: 36px;
  box-sizing: border-box;
  padding: 6px 16px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 13px;
}

.card-head b {
  font-size: 14px;
}

.legend {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: v-bind("theme.textColor2");
}

.legend span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend i {
  width: 14px;
  height: 8px;
  border-radius: 2px;
}

.empty {
  padding: 60px 0;
  text-align: center;
  color: v-bind("theme.textColor3");
}

.side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.note-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stats {
  display: flex;
  gap: 6px;
}

.stats div {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 10px;
  border-radius: 4px;
  background: v-bind("theme.actionColor");
}

.stats span {
  font-size: 11px;
  color: v-bind("theme.textColor3");
}

.stats b {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.hidden-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.hidden-title {
  font-size: 13px;
  font-weight: 600;
}

.hidden-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.below {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.card {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
}

.week-row,
.champion {
  height: 26px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.week-row.me {
  margin: 0 -8px;
  padding: 0 8px;
  border-radius: 4px;
  background: rgba(24, 160, 88, 0.12);
}

.medal {
  width: 22px;
  height: 22px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  color: v-bind("theme.textColor2");
}

.who {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  display: flex;
  min-width: 0;
  flex-shrink: 1;
}

.week-row .who {
  width: 110px;
  flex-shrink: 0;
}

.bar-box {
  flex-grow: 1;
  height: 9px;
  position: relative;
}

.bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px 5px 5px 2px;
}

.num {
  font-variant-numeric: tabular-nums;
}

.week {
  width: 78px;
  flex-shrink: 0;
}

.champion .who {
  flex-grow: 1;
}

.hot-line {
  margin-top: 4px;
  padding-top: 8px;
  height: auto;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.hot-tag {
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  background: #c76a12;
  border-radius: 3px;
  padding: 0 5px;
  line-height: 16px;
  white-space: nowrap;
}
</style>
