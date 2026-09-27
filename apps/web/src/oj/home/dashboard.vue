<script setup lang="ts">
import { Icon } from "@iconify/vue"
import {
  getAnnouncement,
  getAnnouncementList,
  getClassActivity,
  getKnowledgeMap,
  getContestList,
  getLearnProgress,
  getSubmissions,
  getTutorials,
  getWeeklyRank,
} from "oj/api"
import SubmissionResultTag from "shared/components/SubmissionResultTag.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useProblemJump } from "shared/composables/problemJump"
import { pickHeadline, type Headline } from "oj/user/knowledge"
import { useUserStore } from "shared/store/user"
import { ContestStatus, CONTEST_STATUS } from "utils/constants"
import { duration, parseTime, zonedParts } from "utils/functions"
import type {
  AnnouncementListItem,
  ClassActivity,
  ClassActivityProblem,
  Contest,
  SubmissionListItem,
  WeeklyRank,
} from "utils/types"

type TutorialType = "python" | "c"

interface Track {
  type: TutorialType
  label: string
  /** 接着学的那一课，1 起 */
  step: number
  title: string
  total: number
  /** 打开过的课数 */
  read: number
  lastViewedAt: string | null
}

const router = useRouter()
const userStore = useUserStore()
const { isDesktop } = useBreakpoints()

const tracks = ref<Track[]>([])
const contests = ref<Contest[]>([])
const submissions = ref<SubmissionListItem[]>([])
const announcements = ref<AnnouncementListItem[]>([])
const weekly = ref<WeeklyRank | null>(null)
const classActivity = ref<ClassActivity | null>(null)
/** 知识点地图挑出来的那一句（本周升级 / 再做几道升档 / 去点亮一个），见 oj/user/knowledge.ts */
const knowledgeHeadline = ref<Headline | null>(null)
const loaded = ref(false)
const keyword = ref("")

const greeting = computed(() => {
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
 * 接着学哪一课看的是**服务端留痕**里最近打开的那一课，不是导航栏用的
 * localStorage：机房一台电脑轮着好几个班用，本地记的是上一个人学到哪。
 */
async function loadTrack(type: TutorialType, label: string): Promise<Track | null> {
  const [titles, progress] = await Promise.all([getTutorials(type), getLearnProgress(type)])
  if (!titles.length) return null
  const seen = progress.filter((p) => p.lastViewedAt)
  const latest = seen.reduce<(typeof seen)[number] | null>(
    (acc, p) => (!acc || p.lastViewedAt! > acc.lastViewedAt! ? p : acc),
    null,
  )
  const index = latest ? titles.findIndex((t) => t.id === latest.tutorialId) : -1
  const step = index >= 0 ? index + 1 : 1
  return {
    type,
    label,
    step,
    title: titles[step - 1]!.title,
    total: titles.length,
    read: seen.length,
    lastViewedAt: latest?.lastViewedAt ?? null,
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

async function loadAnnouncements() {
  const res = await getAnnouncementList(0, 4)
  announcements.value = res.results
}

async function loadKnowledge() {
  knowledgeHeadline.value = pickHeadline(await getKnowledgeMap())
}

async function loadClassActivity() {
  classActivity.value = await getClassActivity()
}

/** 今天的就叫「今天」，往前找到的那天标出日期 —— 周一早上看到的是上周五的课 */
const classActivityTitle = computed(() => {
  const day = classActivity.value?.day
  if (!day) return ""
  const now = zonedParts(new Date())!
  const today = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`
  // 老师在课堂看板布置的，说成「老师布置的」，比「班里在做」更让人知道该做这几道
  if (classActivity.value?.source === "teacher") return "今天老师布置的题"
  if (day === today) return "今天班里在做"
  const [, month, date] = day.split("-").map(Number)
  return `${month}月${date}日班里做了`
})

const MY_STATUS: Record<
  ClassActivityProblem["myStatus"],
  { label: string; type: "success" | "warning" | "default" }
> = {
  accepted: { label: "已通过", type: "success" },
  tried: { label: "未通过", type: "warning" },
  none: { label: "没做", type: "default" },
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
  return `/learn/${track.type}/${track.step.toString().padStart(2, "0")}`
}

const { jump, jumping } = useProblemJump()

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

const announcementShow = ref(false)
const announcementTitle = ref("")
const announcementContent = ref("")

async function openAnnouncement(item: AnnouncementListItem) {
  const res = await getAnnouncement(item.id)
  announcementTitle.value = item.title
  announcementContent.value = res.content
  announcementShow.value = true
}
</script>

<template>
  <div class="home">
    <section class="hero">
      <div>
        <h1 class="hello">{{ greeting }}，{{ userStore.user?.username }}</h1>
        <n-text depth="3">
          已解决 {{ userStore.profile?.acceptedNumber ?? 0 }} 题 · 共提交
          {{ userStore.profile?.submissionNumber ?? 0 }} 次
          <template v-if="weeklyText">
            ·
            <router-link to="/rank" class="plain-link">{{ weeklyText }}</router-link>
          </template>
        </n-text>
        <div v-if="knowledgeHeadline" class="knowledge-line">
          <router-link v-if="knowledgeHeadline.to" :to="knowledgeHeadline.to" class="plain-link">
            {{ knowledgeHeadline.text }}
          </router-link>
          <span v-else>{{ knowledgeHeadline.text }}</span>
          <router-link to="/user" class="more">我的知识点</router-link>
        </div>
      </div>
      <n-input-group class="search">
        <n-input
          v-model:value="keyword"
          placeholder="题号或题目名"
          clearable
          @keyup.enter="jump(keyword)"
        />
        <n-button type="primary" :loading="jumping" @click="jump(keyword)">找题</n-button>
      </n-input-group>
    </section>

    <div class="grid">
      <div class="column">
        <!-- 只在有的时候出现：没班级、最近一周班里没一起做过题的，这块不占位置 -->
        <n-card
          v-if="classActivity?.problems.length"
          :title="classActivityTitle"
          size="small"
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
            <!-- 老师刚布置、还没人交的时候不显示「0/0 人通过」 -->
            <n-text v-if="item.userCount" depth="3" class="row-meta">
              {{ item.acceptedCount }}/{{ item.userCount }} 人通过
            </n-text>
          </router-link>
        </n-card>

        <n-card title="继续学习" size="small" :bordered="false" class="card">
          <n-flex vertical :size="12">
            <router-link
              v-for="track in tracks"
              :key="track.type"
              :to="learnLink(track)"
              class="track"
            >
              <div class="track-main">
                <n-text depth="3" class="track-label">
                  {{ track.label }} · 第 {{ track.step }} / {{ track.total }} 课
                </n-text>
                <div class="track-title">{{ track.title }}</div>
                <n-progress
                  type="line"
                  :percentage="Math.round((track.read / track.total) * 100)"
                  status="success"
                  :show-indicator="false"
                  :height="6"
                />
                <n-text depth="3" class="track-meta">
                  已打开 {{ track.read }} 课
                  <template v-if="track.lastViewedAt">
                    · 上次 {{ relativeTime(track.lastViewedAt) }}
                  </template>
                </n-text>
              </div>
              <n-button :type="track.lastViewedAt ? 'primary' : 'default'" tag="span">
                {{ track.lastViewedAt ? "继续" : "开始" }}
              </n-button>
            </router-link>
            <n-empty v-if="loaded && !tracks.length" description="还没有公开的教程" />
          </n-flex>
        </n-card>

        <n-card title="最近提交" size="small" :bordered="false" class="card">
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
      </div>

      <div class="column">
        <n-card title="比赛" size="small" :bordered="false" class="card">
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
          <n-text v-if="loaded && !contests.length" depth="3">
            现在没有进行中或即将开始的比赛
          </n-text>
        </n-card>

        <n-card title="公告" size="small" :bordered="false" class="card">
          <template #header-extra>
            <router-link to="/announcement" class="more">全部</router-link>
          </template>
          <div
            v-for="item in announcements"
            :key="item.id"
            class="row clickable"
            @click="openAnnouncement(item)"
          >
            <n-tag v-if="item.top" type="error" size="small" :bordered="false">置顶</n-tag>
            <span class="row-title">{{ item.title }}</span>
            <n-text depth="3" class="row-meta">{{ parseTime(item.createTime, "M月D日") }}</n-text>
          </div>
        </n-card>

        <n-card size="small" :bordered="false" class="card">
          <n-flex :size="8" class="shortcuts">
            <n-button secondary @click="router.push('/problem')">
              <template #icon><Icon icon="fluent-emoji:memo" /></template>
              题库
            </n-button>
            <n-button secondary @click="router.push('/problemset')">
              <template #icon><Icon icon="fluent-emoji:clipboard" /></template>
              题单
            </n-button>
            <n-button secondary @click="router.push('/achievement')">
              <template #icon><Icon icon="fluent-emoji:sports-medal" /></template>
              成就
            </n-button>
            <n-button secondary @click="router.push('/ai-analysis')">
              <template #icon><Icon icon="fluent-emoji:crystal-ball" /></template>
              智能分析
            </n-button>
          </n-flex>
        </n-card>
      </div>
    </div>

    <n-modal
      v-model:show="announcementShow"
      preset="card"
      :style="{ maxWidth: isDesktop ? '70vw' : undefined, maxHeight: '80vh' }"
      :content-style="{ overflow: 'auto' }"
      :title="announcementTitle"
    >
      <div v-html="announcementContent"></div>
    </n-modal>
  </div>
</template>

<style scoped>
.home {
  max-width: 1200px;
  margin: 0 auto;
}

.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin: 8px 0 20px;
}

.hello {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 6px;
}

.knowledge-line {
  margin-top: 6px;
  display: flex;
  gap: 12px;
  align-items: baseline;
  color: #18a058;
}

/* 这一行本身就是链接（去按知识点筛的题目列表），下划线说明它能点 */
.knowledge-line .plain-link {
  color: #18a058;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.search {
  width: 320px;
  max-width: 100%;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.card {
  border-radius: 8px;
  background-color: var(--n-color-embedded, rgba(128, 128, 128, 0.06));
}

.track {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  border-radius: 6px;
  color: inherit;
  text-decoration: none;
  background-color: rgba(128, 128, 128, 0.06);
  transition: background-color 0.2s;
}

.track:hover {
  background-color: rgba(24, 160, 88, 0.1);
}

.track-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.track-label,
.track-meta,
.row-meta {
  font-size: 12px;
}

.track-title {
  font-size: 16px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
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

.more,
.plain-link {
  color: inherit;
  text-decoration: none;
}

.more {
  font-size: 13px;
  opacity: 0.7;
}

.more:hover,
.plain-link:hover {
  color: #18a058;
}
</style>
