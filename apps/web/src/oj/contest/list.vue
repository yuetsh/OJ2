<script setup lang="ts">
import { useRouteQuery } from "@vueuse/router"
import { useThemeVars } from "naive-ui"
import { getContestList } from "oj/api"
import { useTone } from "oj/submission/composables/tone"
import { contestLength, parseTime, secondsToDuration } from "utils/functions"
import type { Contest } from "utils/types"
import ContestTitle from "shared/components/ContestTitle.vue"
import Pagination from "shared/components/Pagination.vue"
import { useAuthModalStore } from "shared/store/authModal"
import { usePagination } from "shared/composables/pagination"
import { useUserStore } from "shared/store/user"
import { ContestStatus } from "utils/constants"
import ContestBadge from "./components/ContestBadge.vue"

/**
 * 比赛列表（设计稿「比赛重设计」）：进行中的单独一大块「接着比」，未开始的一行一个，
 * 下面是全部比赛，每场写「我」第几名 / 做对几道 —— 进过前三的带奖杯
 */
const router = useRouter()
const userStore = useUserStore()
const authStore = useAuthModalStore()
const theme = useThemeVars()
const tone = useTone()

interface ContestQuery {
  keyword: string
  /** "" 全部 / joined 我参加过的 / 练习 / 考试 */
  scope: string
}

const { query } = usePagination<ContestQuery>({
  keyword: useRouteQuery("keyword", "").value,
  scope: useRouteQuery("scope", "").value,
})

const data = ref<Contest[]>([])
const total = ref(0)
const active = ref<Contest[]>([])

const scopes = computed(() => [
  { value: "", label: "全部" },
  ...(userStore.isAuthed ? [{ value: "joined", label: "我参加过的" }] : []),
  { value: "练习", label: "练习" },
  { value: "考试", label: "期中 · 期末" },
])

async function listContests() {
  const res = await getContestList({
    offset: (query.page - 1) * query.limit,
    limit: query.limit,
    keyword: query.keyword,
    status: "",
    tag: query.scope === "joined" ? "" : query.scope,
    joined: query.scope === "joined",
  })
  data.value = res.results
  total.value = res.total
}

// 进行中 / 即将开始的单独拎到最上面：表格按开始时间倒序，一场开了一周的练习赛
// 会被后来建的比赛压到第二页去，学生找不着正在比的那一场
async function listActive() {
  const base = { offset: 0, limit: 6, keyword: "", tag: "" }
  const [underway, upcoming] = await Promise.all([
    getContestList({ ...base, status: ContestStatus.underway }),
    getContestList({ ...base, status: ContestStatus.not_started }),
  ])
  active.value = [...underway.results, ...upcoming.results.reverse()]
}

const plain = computed(() => query.page === 1 && !query.keyword && !query.scope)
const running = computed(() =>
  plain.value ? active.value.filter((c) => c.status === ContestStatus.underway) : [],
)
const upcoming = computed(() =>
  plain.value ? active.value.filter((c) => c.status === ContestStatus.not_started) : [],
)
/** 上面单独列过的，下面表里不再重复 */
const rows = computed(() => {
  const shown = new Set([...running.value, ...upcoming.value].map((c) => c.id))
  return data.value.filter((c) => !shown.has(c.id))
})

onMounted(() => {
  listContests()
  listActive()
})
watchDebounced(() => query.keyword, listContests, { debounce: 500, maxWait: 1000 })
watch(() => [query.page, query.limit, query.scope], listContests)

const now = useNow({ interval: 1000 })
function remaining(contest: Contest) {
  const seconds = Math.floor((Date.parse(contest.endTime) - now.value.getTime()) / 1000)
  const text = secondsToDuration(Math.max(0, seconds))
  return text.startsWith("0:") ? text.slice(2) : text
}
function untilStart(contest: Contest) {
  const ms = Date.parse(contest.startTime) - now.value.getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `还有 ${days} 天`
  return `还有 ${secondsToDuration(Math.max(0, Math.floor(ms / 1000)))}`
}
function range(contest: Contest) {
  const sameDay =
    parseTime(contest.startTime, "YYYY-MM-DD") === parseTime(contest.endTime, "YYYY-MM-DD")
  return `${parseTime(contest.startTime, "HH:mm")} – ${parseTime(contest.endTime, sameDay ? "HH:mm" : "M月D日 HH:mm")}`
}

function open(contest: Contest) {
  if (!userStore.isAuthed) {
    authStore.openLoginModal()
    return
  }
  // 老师直接进「全班情况」
  router.push(
    userStore.isTeacherOrAbove ? `/contest/${contest.id}/class` : `/contest/${contest.id}`,
  )
}

function mineText(contest: Contest) {
  const mine = contest.mine
  if (!mine) return ""
  const solved = `做对 ${mine.solved}/${contest.problemCount ?? "?"}`
  return mine.rank ? `第 ${mine.rank} 名 / ${mine.total} · ${solved}` : solved
}

const success = computed(() => tone("success"))
const warning = computed(() => tone("warning"))
</script>

<template>
  <div class="page">
    <div class="top">
      <h2>比赛</h2>
      <div class="spacer"></div>
      <button
        v-for="item in scopes"
        :key="item.value"
        class="chip"
        :class="{ on: query.scope === item.value }"
        @click="query.scope = item.value"
      >
        {{ item.label }}
      </button>
      <n-input v-model:value="query.keyword" clearable placeholder="比赛名" style="width: 200px" />
    </div>

    <div
      v-for="contest in running"
      :key="contest.id"
      class="running"
      role="link"
      tabindex="0"
      @click="open(contest)"
      @keyup.enter="open(contest)"
    >
      <ContestBadge :status="ContestStatus.underway" />
      <div class="running-main">
        <div class="running-title">
          <ContestTitle :contest="contest" />
          <ContestBadge :tag="contest.tag" />
        </div>
        <span class="muted small">
          {{ range(contest) }} · {{ contest.problemCount }} 道题 ·
          {{ contest.participantCount }} 人在比
        </span>
      </div>
      <div class="spacer"></div>
      <div class="running-right">
        <span v-if="contest.mine" class="small sec">
          <template v-if="contest.mine.rank"
            >你第 <b class="green">{{ contest.mine.rank }}</b> 名 · </template
          >做对 {{ contest.mine.solved }} 道
        </span>
        <span class="countdown"
          ><span class="small">还剩</span> <b>{{ remaining(contest) }}</b></span
        >
      </div>
      <n-button type="primary" size="large" @click.stop="open(contest)">
        {{ contest.mine ? "接着比 ›" : "进去比 ›" }}
      </n-button>
    </div>

    <div
      v-for="contest in upcoming"
      :key="contest.id"
      class="upcoming"
      role="link"
      tabindex="0"
      @click="open(contest)"
      @keyup.enter="open(contest)"
    >
      <ContestBadge :status="ContestStatus.not_started" />
      <ContestTitle :contest="contest" class="upcoming-title" />
      <ContestBadge :tag="contest.tag" />
      <div class="spacer"></div>
      <span class="small sec">
        {{ parseTime(contest.startTime, "M月D日 HH:mm") }} 开始 · 比
        {{ contestLength(contest.startTime, contest.endTime) }}
      </span>
      <span class="small amber">{{ untilStart(contest) }}</span>
    </div>

    <div class="table">
      <div class="tr th">
        <span>{{ plain ? "已结束" : "比赛" }}</span>
        <span>类型</span>
        <span>日期</span>
        <span>时长</span>
        <span>我</span>
      </div>
      <div
        v-for="contest in rows"
        :key="contest.id"
        class="tr"
        :class="{ done: contest.status === ContestStatus.finished }"
        role="link"
        tabindex="0"
        @click="open(contest)"
        @keyup.enter="open(contest)"
      >
        <span class="name">
          <ContestBadge
            v-if="contest.status !== ContestStatus.finished"
            :status="contest.status as ContestStatus"
          />
          <ContestTitle :contest="contest" />
        </span>
        <span><ContestBadge :tag="contest.tag" /></span>
        <span class="muted small num">{{ parseTime(contest.startTime, "YYYY-MM-DD") }}</span>
        <span class="muted small">{{ contestLength(contest.startTime, contest.endTime) }}</span>
        <span class="mine small">
          <template v-if="contest.mine">
            <svg
              v-if="contest.mine.rank && contest.mine.rank <= 3"
              width="14"
              height="14"
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
            <span class="sec">{{ mineText(contest) }}</span>
          </template>
          <span
            v-else-if="userStore.isAuthed && contest.status === ContestStatus.finished"
            class="faint"
            >没参加</span
          >
        </span>
      </div>
      <div v-if="!rows.length" class="empty muted">
        {{ query.scope === "joined" ? "你还没参加过比赛" : "没有符合的比赛" }}
      </div>
    </div>
  </div>
  <Pagination v-model:limit="query.limit" v-model:page="query.page" :total="total" />
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.top h2 {
  margin: 0;
  font-size: 20px;
}

.spacer {
  flex-grow: 1;
}

.muted {
  color: v-bind("theme.textColor3");
}

.faint {
  color: v-bind("theme.textColor3");
  opacity: 0.7;
}

.sec {
  color: v-bind("theme.textColor2");
}

.small {
  font-size: 13px;
}

.num {
  font-variant-numeric: tabular-nums;
}

.green {
  color: v-bind("success.color");
}

.amber {
  color: v-bind("warning.color");
}

.chip {
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid v-bind("theme.borderColor");
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.chip.on {
  border-color: transparent;
  background: v-bind("success.background");
  color: v-bind("success.color");
  font-weight: 600;
}

.running {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px 20px;
  border-radius: 6px;
  border: 1px solid v-bind("theme.successColor");
  background: v-bind("success.background");
  cursor: pointer;
}

.running-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.running-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 20px;
  font-weight: 700;
}

.running-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.countdown {
  color: v-bind("warning.color");
}

.countdown b {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}

.upcoming {
  padding: 12px 20px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 16px;
  border-radius: 6px;
  border: 1px solid v-bind("theme.borderColor");
  cursor: pointer;
}

.upcoming-title {
  font-size: 15px;
  font-weight: 600;
}

.table {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  overflow: hidden;
}

.tr {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) 70px 110px 130px minmax(160px, 260px);
  align-items: center;
  gap: 14px;
  min-height: 38px;
  padding: 0 20px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  cursor: pointer;
}

.tr:last-child {
  border-bottom: 0;
}

.tr:not(.th):hover {
  background: v-bind("theme.hoverColor");
}

.th {
  min-height: 32px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
  cursor: default;
}

.name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tr.done .name {
  color: v-bind("theme.textColor2");
}

.mine {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cup {
  color: #b07d00;
  flex-shrink: 0;
}

.empty {
  padding: 24px 20px;
}

@media (max-width: 760px) {
  .tr {
    grid-template-columns: 1fr auto;
  }

  .tr > span:nth-child(3),
  .tr > span:nth-child(4) {
    display: none;
  }
}
</style>
