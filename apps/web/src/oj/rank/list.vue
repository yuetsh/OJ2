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
import { clearMood, getClassBattle, getRankBoard, getWeeklyChampions, setRankHidden } from "oj/api"
import { classLabel } from "oj/submission/utils"
import UserName from "shared/components/UserName.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useConfigStore } from "shared/store/config"
import { useUserStore } from "shared/store/user"
import { USERNAME_CLASS_RE } from "utils/constants"
import { parseTime } from "utils/functions"
import ChampionList from "./components/ChampionList.vue"
import ClassBattle from "./components/ClassBattle.vue"
import ClassDetailDrawer from "./components/ClassDetailDrawer.vue"
import RankMe, { type MiniRank } from "./components/RankMe.vue"
import RankPodium from "./components/RankPodium.vue"
import RankTrack from "./components/RankTrack.vue"
import RankTrend from "./components/RankTrend.vue"
import WeekTop from "./components/WeekTop.vue"
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
 * 上面：领奖台 + 全班赛道，右边是「你」和班级对抗（不必刻意塞进机房一屏，用户嫌行太矮）；往下是名次走势、
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
    // 老师在「全部」时点了本班：后端挑了最近上课的班，回填到下拉框（这一下不用再取一遍）
    if (teacher.value && !teacherClass.value && board.value.scope === "class") {
      backfilling = true
      teacherClass.value = board.value.className ?? ""
    }
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

let backfilling = false

/** 范围、时间、老师选的班：三个一起变（下拉框选班会顺手改范围）也只取一次 */
watch([scope, period, teacherClass], () => {
  router.replace({
    query: {
      ...route.query,
      scope: scope.value,
      period: period.value,
      class: teacher.value && teacherClass.value ? teacherClass.value : undefined,
    },
  })
  if (backfilling) backfilling = false
  else load()
})

onMounted(async () => {
  if (!userStore.user) await userStore.getMyProfile().catch(() => {})
  // 老师默认看全部（用户定的），要看哪个班自己在下拉框里选；学生默认看本班
  const fallback = teacher.value ? "all" : canScopeClass.value ? "class" : "all"
  scope.value = pick(route.query.scope, SCOPE_OPTIONS, fallback)
  if (!canScopeClass.value && scope.value !== "all") scope.value = "all"
  loadBattle()
  // scope 从 "all" 改成别的会触发 watch 去取；没改就自己取
  if (scope.value === "all") load()
})

/** 班级那几块（走势、这周本班、每周冠军、班级对抗高亮）对的是哪个班 */
const classContext = computed(
  () => (teacher.value ? (scope.value === "all" ? "" : teacherClass.value) : myClass.value) || null,
)

/** 老师的班级下拉框：「全部」就是全服，选了班就切到本班（本年级时留在本年级） */
const pickedClass = computed({
  get: () => (scope.value === "all" ? "" : teacherClass.value),
  set: (value: string) => {
    teacherClass.value = value
    if (!value) scope.value = "all"
    else if (scope.value === "all") scope.value = "class"
  },
})

const rows = computed(() => board.value?.rows ?? [])
const podium = computed(() => rows.value.filter((row) => row.rank <= 3 && row.solved > 0))
const trackRows = computed(() =>
  rows.value.filter((row) => row.rank > 3 || (row.rank <= 3 && !row.solved)),
)
/** 条的满格：第 2 名的数。第 1 名常常一骑绝尘，按它算别人的条全挤在左边 */
const scale = computed(() => rows.value[1]?.solved || rows.value[0]?.solved || 1)
const hot = computed(() => hottest(rows.value))

const me = computed(() => board.value?.me ?? null)
/** 全服 100 名以外：「你」卡照样有，但名单上没有你这一行，图例和副标题别再提「你」 */
const meListed = computed(() => {
  const b = board.value
  return !!b?.me && !(b.cap && b.me.rank > b.cap)
})
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
  const capped = !!b.cap && b.total > b.cap
  const part = !b.complete
    ? meListed.value
      ? " · 前面一段 + 你附近一段"
      : ` · 只列前面 ${b.rows.length} 名`
    : capped
      ? ` · 只列前 ${b.cap} 名`
      : ""
  return `${head} · 一样多的，先做到的在前${part}`
})
/** 手机上标题旁边那句：只说从哪天起、跟什么时候比 */
const shortRule = computed(() => {
  const b = board.value
  if (!b) return ""
  const from = b.start ? `${parseTime(b.start, "M月D日")}起` : "全部历史"
  return `${from} · ↑↓ 比${b.period === "week" ? "今天早上" : "周一"}`
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
      cap: other?.cap,
      go: () => (scope.value = s),
    })
  }
  return list.slice(0, 3)
})

const teacherClassOptions = computed(() => {
  const list = configStore.config?.classList ?? []
  const all =
    teacherClass.value && !list.includes(teacherClass.value) ? [teacherClass.value, ...list] : list
  return [
    { label: "全部", value: "" },
    ...all.map((name) => ({ label: classLabel(name), value: name })),
  ]
})

const myBattle = computed(() => battle.value.find((item) => item.className === classContext.value))

const daysLeft = computed(() => {
  const start = weekBoard.value?.start
  if (!start) return 0
  return Math.max(1, Math.ceil((Date.parse(start) + 7 * 86_400_000 - Date.now()) / 86_400_000))
})

/** 走势图三条线：后一名、前一名、你（画在最上面） */
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

const weekTitle = computed(() =>
  teacher.value && classContext.value ? `这周 · ${classLabel(classContext.value)}` : "这周本班",
)

/** 手机上的页签：没有班就只剩班级对抗，没有走势（这周 / 老师）就不给走势那页 */
const phoneTabs = computed(() => [
  { key: "battle", label: "班级对抗" },
  ...(board.value?.trend && me.value ? [{ key: "trend", label: "名次走势" }] : []),
  ...(classContext.value
    ? [
        { key: "week", label: teacher.value ? "这周" : "这周本班" },
        { key: "champions", label: "每周冠军" },
      ]
    : []),
])
const phoneTab = ref("battle")
watch(phoneTabs, (tabs) => {
  if (!tabs.some((tab) => tab.key === phoneTab.value)) phoneTab.value = "battle"
})

/** 班级详情（+ 老师的 AI 分析）：点班级对抗里的班名、或老师「这个班」卡上的按钮 */
const detailClass = ref<string | null>(null)
const showDetail = ref(false)
function openDetail(className: string) {
  detailClass.value = className
  showDetail.value = true
}

function open(username: string) {
  router.push({ path: "/user", query: { name: username } })
}

/** 老师看某个学生的智能分析（那一页本来就支持 ?username=） */
function openAnalysis(username: string) {
  router.push({ path: "/ai-analysis", query: { username } })
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

/** 签名改了 / 清了：榜上这个人的每一处（赛道、领奖台、「你」卡、前后一名）就地换掉，不重取 */
function setMood(userId: number, mood: string | null) {
  const b = board.value
  if (!b) return
  for (const row of [...b.rows, b.me, b.ahead, b.behind])
    if (row?.user.id === userId) row.mood = mood
}

function onMoodSaved(mood: string | null) {
  if (meId.value) setMood(meId.value, mood)
}

function confirmClearMood(row: RankRow) {
  dialog.warning({
    title: "清空个性签名",
    content: `${row.user.username} 的签名「${row.mood}」会被清空。只清这一句，他之后还能重新写。`,
    positiveText: "清空",
    negativeText: "取消",
    onPositiveClick: async () => {
      await clearMood(row.user.id)
      setMood(row.user.id, null)
      message.success("签名已清空")
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
</script>

<template>
  <div class="rank-page oj-page">
    <div class="toolbar" :class="{ single: !isDesktop }">
      <div class="title">
        <h2>排名</h2>
        <span v-if="!isDesktop" class="rule">{{ shortRule }}</span>
      </div>
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
        v-if="teacher"
        v-model:value="pickedClass"
        class="class-select"
        filterable
        placeholder="选班"
        :options="teacherClassOptions"
      />
      <template v-if="isDesktop">
        <div class="spacer" />
        <span class="rule">{{ ruleText }}</span>
      </template>
    </div>

    <div class="main" :class="{ single: !isDesktop }">
      <n-spin :show="loading" class="track-card">
        <template v-if="board">
          <div class="card-head">
            <b>{{ title }}</b>
            <span class="muted">{{ subtitle }}</span>
            <div class="spacer" />
            <span v-if="!teacher && me" class="legend">
              <span v-if="meListed"><i :style="{ background: palette.me }" />你</span>
              <span v-if="board.ahead"><i :style="{ background: palette.chase }" />前一名</span>
              <span v-if="board.behind"><i :style="{ background: palette.threat }" />后一名</span>
              <span v-if="mateClass"><i :style="{ background: palette.mate }" />你们班</span>
            </span>
          </div>
          <RankPodium
            :rows="podium"
            :me-id="meId"
            :chase-id="board.ahead?.user.id"
            :threat-id="board.behind?.user.id"
            :teacher="teacher"
            @open="open"
            @clear-mood="confirmClearMood"
          />
          <RankTrack
            :key="`${board.scope}|${board.period}|${board.className}`"
            :rows="trackRows"
            :whole-label="board.scope === 'class' ? `看全班 ${board.total} 人` : undefined"
            :total="board.total"
            :complete="board.complete"
            :cap="board.cap"
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
            @analysis="openAnalysis"
            @hide="hide"
            @clear-mood="confirmClearMood"
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
            :cap="board.cap"
            :last-listed="board.lastListed"
            :label="`${scopeLabel(board.scope)} · ${periodLabel(board.period)}`"
            :minis="minis"
            :compact="!isDesktop"
            @mood-saved="onMoodSaved"
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
            <div class="actions">
              <n-button v-if="classContext" secondary type="info" @click="openDetail(classContext)">
                班级详情 · AI 分析
              </n-button>
              <n-button
                secondary
                @click="
                  router.push({
                    path: '/class',
                    query: classContext ? { classes: classContext } : {},
                  })
                "
                >班级 PK</n-button
              >
            </div>
            <div class="hidden-list">
              <span class="hidden-title">不计入排名的人</span>
              <template v-if="board.scope === 'class'">
                <div v-for="user in board.hiddenUsers" :key="user.id" class="hidden-row">
                  <UserName :username="user.username" />
                  <n-button size="small" secondary @click="restore(user.id)">恢复</n-button>
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
        <ClassBattle
          v-if="isDesktop"
          :items="battle"
          :mine="classContext"
          :teacher="teacher"
          :pk="userStore.isAuthed"
          @pick="openDetail"
        />
      </aside>
    </div>
    <div v-if="isDesktop && classContext" class="below">
      <div v-if="board?.trend && me" class="card">
        <div class="card-title">
          <b>我和前后一名的名次</b><span class="muted">每周日晚上 · 越高越好</span>
        </div>
        <RankTrend :trend="board.trend" :lines="trendLines" />
      </div>
      <div class="card">
        <div class="card-title">
          <b>{{ weekTitle }}</b>
          <span class="muted">还剩 {{ daysLeft }} 天 · 下周一清零</span>
        </div>
        <WeekTop :rows="weekBoard?.rows ?? []" :me-id="meId" :loaded="!!weekBoard" @open="open" />
      </div>
      <div class="card">
        <div class="card-title">
          <b>每周冠军</b><span class="muted">本班 · 每周一清零后重新比</span>
        </div>
        <ChampionList
          :champions="champions"
          :hot="hot"
          :since="period === 'week' ? '今天' : '这周'"
          :me-id="meId"
          @open="open"
        />
      </div>
    </div>

    <!-- 手机：赛道下面四块收成一张页签卡（设计稿「手机版」），不然整页四屏多 -->
    <div v-if="!isDesktop" class="card tabs-card">
      <div class="tabs" role="tablist">
        <button
          v-for="tab in phoneTabs"
          :key="tab.key"
          role="tab"
          :aria-selected="phoneTab === tab.key"
          :class="{ on: phoneTab === tab.key }"
          @click="phoneTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="tab-body">
        <ClassBattle
          v-if="phoneTab === 'battle'"
          bare
          :items="battle"
          :mine="classContext"
          :teacher="teacher"
          :pk="userStore.isAuthed"
          @pick="openDetail"
        />
        <RankTrend
          v-else-if="phoneTab === 'trend' && board?.trend"
          :trend="board.trend"
          :lines="trendLines"
        />
        <template v-else-if="phoneTab === 'week'">
          <span class="muted">{{ weekTitle }} · 还剩 {{ daysLeft }} 天 · 下周一清零</span>
          <WeekTop :rows="weekBoard?.rows ?? []" :me-id="meId" :loaded="!!weekBoard" @open="open" />
        </template>
        <ChampionList
          v-else-if="phoneTab === 'champions'"
          :champions="champions"
          :hot="hot"
          :since="period === 'week' ? '今天' : '这周'"
          :me-id="meId"
          @open="open"
        />
      </div>
    </div>
    <ClassDetailDrawer
      v-model:show="showDetail"
      :class-name="detailClass"
      :teacher="teacher"
      :pk="userStore.isAuthed"
    />
  </div>
</template>

<style scoped>
/* 比别的阅读型页面宽一点：右栏 400 固定，左边赛道要排两列名字 */
.rank-page {
  max-width: 1280px;
  display: flex;
  flex-direction: column;
  gap: var(--oj-gap);
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar h2 {
  margin: 0;
  font-size: var(--oj-fs-title);
}

.seg {
  display: inline-flex;
  height: var(--oj-ctrl-h);
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 4px;
  overflow: hidden;
}

.seg button {
  padding: 0 14px;
  border: 0;
  border-left: 1px solid v-bind("theme.borderColor");
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor2");
  font: inherit;
  font-size: var(--oj-fs-sec);
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
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
}

.main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: var(--oj-gap);
  align-items: start;
}

.main.single {
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
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
  min-width: 0;
}

.track-card {
  min-height: 300px;
}

.card-head {
  min-height: 52px;
  box-sizing: border-box;
  padding: 10px 24px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: var(--oj-fs-sec);
}

.card-head b {
  font-size: var(--oj-fs-h2);
}

.legend {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--oj-fs-meta);
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
  gap: var(--oj-gap);
  min-width: 0;
}

.note-card {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: var(--oj-fs-sec);
}

.note-card > b {
  font-size: var(--oj-fs-h2);
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
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.stats b {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  gap: 8px;
}

.hidden-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.hidden-title {
  font-size: var(--oj-fs-sec);
  font-weight: 600;
}

.hidden-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--oj-fs-sec);
}

.below {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--oj-gap);
  align-items: start;
}

.card {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2px 8px;
  margin-bottom: 4px;
}

.card-title b {
  font-size: var(--oj-fs-h2);
}

.tabs-card {
  padding: 0;
  gap: 0;
  overflow: hidden;
}

.tabs {
  display: flex;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.tabs button {
  flex: 1;
  height: 44px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  font: inherit;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.tabs button.on {
  color: #18a058;
  font-weight: 600;
  border-bottom-color: #18a058;
}

.tab-body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 手机：标题一行，两组开关各占满一行，手指好点 */
.toolbar.single {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.toolbar.single .seg {
  display: flex;
  height: 36px;
}

.toolbar.single .seg button {
  flex: 1;
  font-size: 14px;
}

.toolbar.single .class-select {
  width: 100%;
}
</style>
