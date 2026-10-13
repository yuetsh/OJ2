<script setup lang="ts">
import { continueStep, doneCount, lessonPath, splitTitle, type TutorialType } from "oj/learn/lesson"
import { Icon } from "@iconify/vue"
import {
  getAnnouncementList,
  getClassActivity,
  getKnowledgeMap,
  getContestList,
  getLastVisit,
  getLearnProgress,
  getSubmissions,
  getTutorials,
  getWeeklyRank,
} from "oj/api"
import SubmissionResultTag from "shared/components/SubmissionResultTag.vue"
import { pickHeadline, type Headline } from "oj/user/knowledge"
import { useUserStore } from "shared/store/user"
import { ContestStatus, CONTEST_STATUS, JUDGE_STATUS, LANGUAGE_SHOW_VALUE } from "utils/constants"
import { duration, parseTime, zonedParts, zonedYear } from "utils/functions"
import type {
  AnnouncementListItem,
  ClassActivity,
  ClassActivityProblem,
  Contest,
  LastVisit,
  SubmissionListItem,
  WeeklyRank,
} from "utils/types"

interface Track {
  type: TutorialType
  label: string
  /** 接着学的那一课，1 起 */
  step: number
  title: string
  total: number
  /** 学完的课数（练一练全对） */
  done: number
  lastViewedAt: string | null
}

const router = useRouter()
const userStore = useUserStore()

const tracks = ref<Track[]>([])
const contests = ref<Contest[]>([])
const submissions = ref<SubmissionListItem[]>([])
const announcements = ref<AnnouncementListItem[]>([])
const weekly = ref<WeeklyRank | null>(null)
const classActivity = ref<ClassActivity | null>(null)
const lastVisit = ref<LastVisit | null>(null)
/** 知识点地图挑出来的那一句（本周升级 / 再做几道升档 / 去点亮一个），见 oj/user/knowledge.ts */
const knowledgeHeadline = ref<Headline | null>(null)
const loaded = ref(false)

/** 头一回登录、还没交过：问候换成「欢迎」，告诉他题在哪找 */
const firstVisit = computed(
  () =>
    !!lastVisit.value &&
    !lastVisit.value.previousLogin &&
    (userStore.profile?.submissionNumber ?? 0) === 0,
)

/** 离上次来多少天。超过 30 天后端不给「上次来」卡，这里只在问候里说一句 */
const awayDays = computed(() => {
  const previous = lastVisit.value?.previousLogin
  if (!previous) return 0
  return Math.floor((Date.now() - new Date(previous).getTime()) / 864e5)
})
const longAway = computed(() => awayDays.value > 30)

const awayText = computed(() => {
  const previous = lastVisit.value?.previousLogin
  if (!previous) return ""
  const days = awayDays.value
  const gap =
    days >= 365
      ? `隔了 ${Math.floor(days / 365)} 年多`
      : days >= 60
        ? `隔了 ${Math.floor(days / 30)} 个月`
        : `隔了 ${days} 天`
  return `上次来是 ${dateText(previous)}，${gap}`
})

const greeting = computed(() => {
  if (longAway.value) return "好久不见"
  const hour = zonedParts(new Date())!.hour
  if (hour < 5) return "夜深了"
  if (hour < 11) return "早上好"
  if (hour < 13) return "中午好"
  if (hour < 18) return "下午好"
  return "晚上好"
})

const weeklyText = computed(() => {
  const me = weekly.value?.me
  if (!weekly.value) return ""
  const where = weekly.value.scope === "class" ? "班里" : "全站"
  if (!me) return "本周还没有新通过的题，做出 1 题就能上进步榜"
  return `本周新通过 ${me.solvedCount} 题，${where}第 ${me.rank} 名`
})

/**
 * 接着学哪一课看的是**服务端留痕**（和自学首页同一套，oj/learn/lesson.ts），不是本机记的：
 * 机房一台电脑轮着好几个班用，本地记的是上一个人学到哪。
 */
async function loadTrack(type: TutorialType, label: string): Promise<Track | null> {
  const [titles, rows] = await Promise.all([getTutorials(type), getLearnProgress(type)])
  if (!titles.length) return null
  const progress = Object.fromEntries(rows.map((row) => [row.tutorialId, row]))
  const step = continueStep(titles, progress) ?? 1
  const lastViewedAt = rows.reduce<string | null>(
    (acc, row) => (row.lastViewedAt && (!acc || row.lastViewedAt > acc) ? row.lastViewedAt : acc),
    null,
  )
  return {
    type,
    label,
    step,
    title: splitTitle(titles[step - 1]!.title).kp,
    total: titles.length,
    done: doneCount(titles, progress),
    lastViewedAt,
  }
}

async function loadTracks() {
  const res = await Promise.all([loadTrack("python", "Python"), loadTrack("c", "C 语言")])
  // 最近在学的那门排前面；两门都没碰过就按原顺序
  tracks.value = res
    .filter((t): t is Track => !!t)
    .sort((a, b) => (b.lastViewedAt ?? "").localeCompare(a.lastViewedAt ?? ""))
}

async function loadContests() {
  const query = { offset: 0, limit: 5, keyword: "", tag: "" }
  const [underway, upcoming] = await Promise.all([
    getContestList({ ...query, status: ContestStatus.underway }),
    getContestList({ ...query, status: ContestStatus.not_started }),
  ])
  contests.value = [...underway.results, ...upcoming.results].slice(0, 5)
}

async function loadSubmissions() {
  const res = await getSubmissions({ myself: "1", offset: 0, limit: 6, language: "" })
  submissions.value = res.results
}

/** 首页放前三条公告（后端置顶在前、再按发布时间），其余从顶栏「公告」进 */
async function loadAnnouncements() {
  const res = await getAnnouncementList(0, 3)
  announcements.value = res.results
}

async function loadKnowledge() {
  knowledgeHeadline.value = pickHeadline(await getKnowledgeMap())
}

async function loadClassActivity() {
  classActivity.value = await getClassActivity()
}

async function loadLastVisit() {
  lastVisit.value = await getLastVisit()
}

/** 东八区的 YYYY-MM-DD，和后端 class-activity 的 day 同一个写法 */
function dayKey(value: Date | string) {
  const p = zonedParts(value)!
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

function dateText(value: string) {
  return parseTime(value, zonedParts(value)!.year === zonedYear() ? "M月D日" : "YYYY年M月D日")
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

/** 「9月27日 周日上午」：机房一个班一周来一两次，说星期几和上下午比说几点几分好认 */
function visitText(value: string) {
  const p = zonedParts(value)!
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]
  const part = p.hour < 12 ? "上午" : p.hour < 18 ? "下午" : "晚上"
  return `${dateText(value)} ${weekday}${part}`
}

/** 班里的题是今天的（老师布置的就是今天）：今天的课排最前，「上次来」只剩卡底一句 */
const classToday = computed(
  () =>
    classActivity.value?.source === "teacher" || classActivity.value?.day === dayKey(new Date()),
)

const visit = computed(() => lastVisit.value?.summary ?? null)

/**
 * 班里那天就是上次来的那天：机房一个班一周来一次，上次来做的往往就是班里那节课的题，
 * 「上次来」卡已经讲了，班里卡不再把同一批题列一遍，只在卡底说一句
 */
const visitCoversClass = computed(
  () =>
    !!visit.value &&
    !!classActivity.value?.problems.length &&
    !classToday.value &&
    classActivity.value.day === dayKey(visit.value.lastSubmitTime),
)

const classSummaryText = computed(() => {
  const problems = classActivity.value?.problems ?? []
  const done = problems.filter((item) => item.myStatus === "accepted").length
  return done === problems.length
    ? `那天班里一起做的 ${problems.length} 道，你都做对了`
    : `那天班里一起做了 ${problems.length} 道，你做对了 ${done} 道`
})

/**
 * 「上次还有 N 道没过」那一句：上次来就是今天（上午上课、下午又登录）时不说 ——
 * 原来照样写「上次（10月13日）」，和今天是同一天
 */
const visitBeforeToday = computed(
  () =>
    !!lastVisit.value?.previousLogin &&
    dayKey(lastVisit.value.previousLogin) !== dayKey(new Date()),
)

/** 这节课下一道没做对的：卡底「接着做」那个大按钮 */
const nextProblem = computed(
  () => classActivity.value?.problems.find((item) => item.myStatus !== "accepted") ?? null,
)
const doneInClass = computed(
  () => classActivity.value?.problems.filter((item) => item.myStatus === "accepted").length ?? 0,
)

const solvedText = computed(() =>
  (visit.value?.solved ?? []).map((item) => `${item.problemDisplayId} ${item.title}`).join("、"),
)

/** 今天的就叫「今天」，往前找到的那天标出日期 —— 周一早上看到的是上周五的课 */
const classActivityTitle = computed(() => {
  const day = classActivity.value?.day
  if (!day) return ""
  // 老师在课堂看板布置的，说成「老师布置的」，比「班里在做」更让人知道该做这几道
  if (classActivity.value?.source === "teacher") {
    const language = classActivity.value.language
    return `这节课${language ? ` · 用${LANGUAGE_SHOW_VALUE[language]}做` : ""}`
  }
  if (classToday.value) return "这节课"
  const [, month, date] = day.split("-").map(Number)
  return `${month}月${date}日班里做了`
})

const MY_STATUS: Record<
  ClassActivityProblem["myStatus"],
  { label: string; type: "success" | "warning" | "default" }
> = {
  accepted: { label: "已做对", type: "success" },
  tried: { label: "没做对", type: "warning" },
  none: { label: "还没做", type: "default" },
}

async function loadWeekly() {
  weekly.value = await getWeeklyRank(userStore.user?.className ? "class" : "global")
}

async function load() {
  // 各块互不依赖，哪块挂了就空着那一块，别让一个接口拖垮整页
  await Promise.allSettled([
    loadTracks(),
    loadContests(),
    loadSubmissions(),
    loadAnnouncements(),
    loadWeekly(),
    loadClassActivity(),
    loadLastVisit(),
    loadKnowledge(),
  ])
  loaded.value = true
}

watch(
  () => userStore.isFinished && userStore.isAuthed,
  (ready) => ready && load(),
  { immediate: true },
)

function learnLink(track: Track) {
  return lessonPath(track.type, track.step)
}

function openSubmission(row: SubmissionListItem) {
  if (row.showLink) router.push(`/submission/${row.id}`)
  else router.push(`/problem/${row.problemDisplayId}`)
}

/** 刚刚 / 12 分钟前 / 今天 14:03 / 9月21日 */
function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const now = zonedParts(new Date())!
  const then = zonedParts(value)!
  if (now.year === then.year && now.month === then.month && now.day === then.day) {
    return parseTime(value, "今天 HH:mm")
  }
  return parseTime(value, now.year === then.year ? "M月D日" : "YYYY年M月D日")
}

function contestTime(contest: Contest) {
  if (contest.status === ContestStatus.underway) {
    return `${parseTime(contest.endTime, "M月D日 HH:mm")} 结束`
  }
  return `${parseTime(contest.startTime, "M月D日 HH:mm")} 开始 · 时长 ${duration(contest.startTime, contest.endTime)}`
}
</script>

<template>
  <div class="home">
    <!-- 中间原来还有一个「题号或题目名 找题」框，和顶栏右上角那个重复，拿掉了 -->
    <section class="hero">
      <h1 v-if="firstVisit" class="hello">欢迎来到判题狗，{{ userStore.user?.username }}</h1>
      <h1 v-else class="hello">{{ greeting }}，{{ userStore.user?.username }}</h1>
      <n-text v-if="firstVisit" depth="3">老师报了题号，在右上角的框里输入就能找到题</n-text>
      <n-text v-else depth="3">
        <template v-if="longAway">{{ awayText }} · </template>
        已解决 {{ userStore.profile?.acceptedNumber ?? 0 }} 题
        <template v-if="weeklyText">
          ·
          <router-link to="/rank" class="plain-link">{{ weeklyText }}</router-link>
        </template>
        <template v-if="knowledgeHeadline">
          ·
          <router-link v-if="knowledgeHeadline.to" :to="knowledgeHeadline.to" class="plain-link">
            {{ knowledgeHeadline.text }}
          </router-link>
          <span v-else>{{ knowledgeHeadline.text }}</span>
        </template>
      </n-text>
    </section>

    <div class="grid">
      <div class="column">
        <!-- 上课时最上面是这节课（设计稿 HomeStuClass）：几道题做没做对，底下一个「接着做」 -->
        <n-card
          v-if="classToday && classActivity?.problems.length"
          :bordered="false"
          class="card lesson"
        >
          <template #header>{{ classActivityTitle }}</template>
          <template #header-extra>
            <n-text depth="3" class="row-meta">
              {{ classActivity.problems.length }} 道做对了 {{ doneInClass }} 道
            </n-text>
          </template>
          <router-link
            v-for="item in classActivity.problems"
            :key="item.problemDisplayId"
            :to="`/problem/${item.problemDisplayId}`"
            class="row"
          >
            <n-tag :type="MY_STATUS[item.myStatus].type" size="small" :bordered="false">
              {{ MY_STATUS[item.myStatus].label }}
            </n-tag>
            <span class="row-title">{{ item.problemDisplayId }} {{ item.title }}</span>
            <!-- 老师刚布置、还没人交的时候不显示「0/0」 -->
            <n-text v-if="item.userCount" depth="3" class="row-meta">
              {{ item.acceptedCount }}/{{ item.userCount }} 人做对
            </n-text>
          </router-link>
          <div class="lesson-foot">
            <n-button
              v-if="nextProblem"
              type="primary"
              size="large"
              @click="router.push(`/problem/${nextProblem.problemDisplayId}`)"
            >
              接着做 {{ nextProblem.problemDisplayId }} {{ nextProblem.title }} →
            </n-button>
            <n-text v-else type="success">这节课的题都做对了</n-text>
          </div>
          <div v-if="visitBeforeToday && visit?.unsolved.length" class="visit-foot warn">
            <span class="dot"></span>
            <span class="row-title">
              上次（{{ dateText(lastVisit!.previousLogin!) }}）还有
              {{ visit.unsolved.length }} 道没做对：{{ visit.unsolved[0]!.problemDisplayId }}
              {{ visit.unsolved[0]!.title }}
            </span>
            <router-link :to="`/problem/${visit.unsolved[0]!.problemDisplayId}`" class="go">
              接着做 ›
            </router-link>
          </div>
        </n-card>

        <!-- 不在上课：上次没做完的排最前（设计稿 HomeStuAfter） -->
        <n-card v-if="visit && !classToday" :bordered="false" class="card">
          <template #header>
            {{ visit.unsolved.length ? "上次没做完" : "上次来" }} ·
            {{ visitText(lastVisit!.previousLogin!) }}
          </template>
          <template #header-extra>
            <n-text depth="3" class="row-meta">
              做对 {{ visit.solvedCount }} 道 · 交了 {{ visit.submissionCount }} 次
            </n-text>
          </template>
          <router-link
            v-for="item in visit.unsolved"
            :key="item.problemDisplayId"
            :to="`/problem/${item.problemDisplayId}`"
            class="unsolved"
          >
            <n-tag type="warning" size="small" :bordered="false">没做对</n-tag>
            <div class="unsolved-main">
              <span class="row-title">
                <n-text depth="3">{{ item.problemDisplayId }}</n-text> {{ item.title }}
              </span>
              <n-text depth="3" class="row-meta">
                交了 {{ item.attempts }} 次，最后一次是{{ JUDGE_STATUS[item.lastResult].name }}
              </n-text>
            </div>
            <n-button type="primary" tag="span">接着做</n-button>
          </router-link>
          <div v-if="visit.solvedCount" class="row">
            <n-tag type="success" size="small" :bordered="false">已做对</n-tag>
            <span class="row-title">{{ visit.solvedCount }} 道：{{ solvedText }}</span>
          </div>
          <div v-if="visitCoversClass" class="visit-foot">
            <Icon icon="ph:check-bold" :width="14" />{{ classSummaryText }}
          </div>
        </n-card>

        <!-- 前几天班里一起做的（不是今天、也不是上次来那天）：只在有的时候出现 -->
        <n-card
          v-if="!classToday && classActivity?.problems.length && !visitCoversClass"
          :title="classActivityTitle"
          :bordered="false"
          class="card"
        >
          <template #header-extra>
            <n-text depth="3" class="row-meta">{{ classActivity.className }} 班</n-text>
          </template>
          <router-link
            v-for="item in classActivity.problems"
            :key="item.problemDisplayId"
            :to="`/problem/${item.problemDisplayId}`"
            class="row"
          >
            <n-tag :type="MY_STATUS[item.myStatus].type" size="small" :bordered="false">
              {{ MY_STATUS[item.myStatus].label }}
            </n-tag>
            <span class="row-title">{{ item.problemDisplayId }} {{ item.title }}</span>
            <n-text v-if="item.userCount" depth="3" class="row-meta">
              {{ item.acceptedCount }}/{{ item.userCount }} 人做对
            </n-text>
          </router-link>
        </n-card>

        <!-- 继续学习：一门一行 -->
        <n-card title="继续学习" :bordered="false" class="card">
          <router-link v-for="track in tracks" :key="track.type" :to="learnLink(track)" class="row">
            <n-text depth="3" class="track-label">{{ track.label }}</n-text>
            <span class="row-title">
              第 {{ track.step }} / {{ track.total }} 课 · {{ track.title }}
            </span>
            <n-button :type="track.lastViewedAt ? 'primary' : 'default'" tag="span" size="small">
              {{ track.lastViewedAt ? "继续" : "开始" }}
            </n-button>
          </router-link>
          <n-empty v-if="loaded && !tracks.length" description="还没有公开的教程" />
        </n-card>
      </div>

      <div class="column">
        <n-card title="最近提交" :bordered="false" class="card">
          <template #header-extra>
            <router-link to="/submission?myself=1" class="more">全部</router-link>
          </template>
          <div
            v-for="row in submissions"
            :key="row.id"
            class="row clickable"
            @click="openSubmission(row)"
          >
            <SubmissionResultTag :result="row.result" size="small" />
            <span class="row-title">{{ row.problemDisplayId }} {{ row.problemTitle }}</span>
            <n-text depth="3" class="row-meta">{{ relativeTime(row.createTime) }}</n-text>
          </div>
          <n-empty v-if="loaded && !submissions.length" description="还没有提交过">
            <template #extra>
              <n-button size="small" @click="router.push('/problem')">去做题</n-button>
            </template>
          </n-empty>
        </n-card>

        <!-- 比赛只在有进行中 / 快开始的时候出现（这学期一场都没办，原来常年一块空卡） -->
        <n-card v-if="contests.length" title="比赛" :bordered="false" class="card">
          <template #header-extra>
            <router-link to="/contest" class="more">全部</router-link>
          </template>
          <router-link
            v-for="contest in contests"
            :key="contest.id"
            :to="`/contest/${contest.id}`"
            class="row stacked"
          >
            <n-flex align="center" :size="8" :wrap="false">
              <n-tag :type="CONTEST_STATUS[contest.status].type" size="small" :bordered="false">
                {{ CONTEST_STATUS[contest.status].name }}
              </n-tag>
              <span class="row-title">{{ contest.title }}</span>
            </n-flex>
            <n-text depth="3" class="row-meta">{{ contestTime(contest) }}</n-text>
          </router-link>
        </n-card>

        <n-card v-if="announcements.length" title="公告" :bordered="false" class="card">
          <template #header-extra>
            <router-link to="/announcement" class="more">全部</router-link>
          </template>
          <router-link
            v-for="item in announcements"
            :key="item.id"
            :to="{ path: '/announcement', query: { id: item.id } }"
            class="row"
          >
            <n-tag v-if="item.top" type="warning" size="small" :bordered="false">置顶</n-tag>
            <span class="row-title">{{ item.title }}</span>
            <n-text depth="3" class="row-meta">{{ dateText(item.createTime) }}</n-text>
          </router-link>
        </n-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home {
  max-width: var(--oj-page-width);
  margin: 0 auto;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 16px 0 24px;
}

.hello {
  font-size: 28px;
  font-weight: 600;
  margin: 0;
}

/* 这节课：卡片描一圈主色，底下一个大按钮 */
.lesson {
  box-shadow: inset 0 0 0 1px rgba(24, 160, 88, 0.35);
}

.lesson-foot {
  padding-top: 12px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--oj-gap);
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.column {
  display: flex;
  flex-direction: column;
  gap: var(--oj-gap);
  min-width: 0;
}

.card {
  border-radius: var(--oj-radius);
  background-color: var(--n-color-embedded, rgba(128, 128, 128, 0.06));
}

/* 卡片用回 Naive 默认的 medium（左右 24），手机上太费地方，收回 16 */
@media (max-width: 600px) {
  .card {
    --n-padding-left: 16px !important;
    --n-padding-right: 16px !important;
  }
}

.track-label {
  flex: none;
  width: 64px;
  font-size: var(--oj-fs-meta);
}

.row-meta {
  font-size: var(--oj-fs-meta);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  box-sizing: border-box;
  padding: 8px 6px;
  font-size: var(--oj-fs-body);
  border-radius: 4px;
  color: inherit;
  text-decoration: none;
}

.row + .row {
  border-top: 1px solid rgba(128, 128, 128, 0.12);
}

.row.stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.clickable,
a.row {
  cursor: pointer;
}

.clickable:hover,
a.row:hover {
  background-color: rgba(128, 128, 128, 0.08);
}

.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  flex-shrink: 0;
}

/* 「上次来」没做对的那几道：一道一个白底块，「接着做」是这张卡唯一的主按钮 */
.unsolved {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 10px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  background-color: var(--n-color, #fff);
  color: inherit;
  text-decoration: none;
}

.unsolved:hover {
  border-color: rgba(24, 160, 88, 0.5);
}

.unsolved-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.visit-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 10px 4px 2px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
  font-size: var(--oj-fs-sec);
  opacity: 0.75;
}

.visit-foot.warn {
  opacity: 1;
}

.visit-foot .dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #f0a020;
}

.visit-foot .go {
  flex: none;
  color: #18a058;
  font-weight: 600;
  text-decoration: none;
}

.more,
.plain-link {
  color: inherit;
  text-decoration: none;
}

.more {
  font-size: var(--oj-fs-sec);
}

.more:hover,
.plain-link:hover {
  color: #18a058;
}
</style>
