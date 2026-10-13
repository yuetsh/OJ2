<script setup lang="ts">
import type { ClassToday } from "@oj2/contract"
import type { AnnouncementListItem } from "utils/types"
import { useThemeVars } from "naive-ui"
import { getAnnouncement, getAnnouncementList, getClassToday } from "oj/api"
import { classLabel } from "oj/submission/utils"
import { useUserStore } from "shared/store/user"
import { parseTime, zonedParts } from "utils/functions"

/**
 * 老师的首页（设计稿「首页重设计」HomeTeacher）。原来老师看到的和学生一样（继续学习、最近提交），
 * 对老师没用。现在最上面是「今天的课」：今天在上课的每个班一行 —— 正在上课 / 几点下课了、
 * 布置了几道、几人交过、全做对几人，每道题一根小条，点「课堂看板」进那个班。
 * 下面是常用入口和置顶的公告
 */
const theme = useThemeVars()
const router = useRouter()
const userStore = useUserStore()

const today = ref<ClassToday | null>(null)
const pinned = ref<AnnouncementListItem[]>([])

/** 最后一次有人交题在这么久以内，算「正在上课」 */
const LIVE_MS = 15 * 60 * 1000

onMounted(async () => {
  const [classes, announcements] = await Promise.allSettled([
    getClassToday(),
    getAnnouncementList(0, 10),
  ])
  if (classes.status === "fulfilled") today.value = classes.value
  if (announcements.status === "fulfilled") {
    pinned.value = announcements.value.results.filter((item) => item.top)
  }
})

const greeting = computed(() => {
  const hour = zonedParts(new Date())!.hour
  if (hour < 5) return "夜深了"
  if (hour < 11) return "上午好"
  if (hour < 13) return "中午好"
  if (hour < 18) return "下午好"
  return "晚上好"
})

type ClassRow = ClassToday["classes"][number]

function stateOf(row: ClassRow) {
  if (!row.lastSubmitAt) return { live: false, text: "布置了，还没人交" }
  if (Date.now() - Date.parse(row.lastSubmitAt) < LIVE_MS) return { live: true, text: "正在上课" }
  return { live: false, text: `${parseTime(row.lastSubmitAt, "HH:mm")} 下课了` }
}

function metaOf(row: ClassRow) {
  const parts = [
    row.source === "teacher" && row.assignedAt
      ? `${parseTime(row.assignedAt, "HH:mm")} 布置了 ${row.problems.length} 道`
      : `做了 ${row.problems.length} 道`,
  ]
  if (row.activeCount) parts.push(`${row.activeCount}/${row.rosterCount} 人交过`)
  if (row.problems.length) parts.push(`全做对 ${row.allDoneCount} 人`)
  return parts.join(" · ")
}

function openBoard(row: ClassRow) {
  router.push({ name: "classroom board", query: { className: row.className } })
}

const shortcuts = computed(() =>
  [
    { label: "课堂看板", to: "/classroom", show: true },
    { label: "数据统计", to: "/statistics", show: true },
    { label: "新建题目", to: "/admin/problem/create", show: userStore.hasProblemPermission },
    { label: "后台", to: userStore.isSuperAdmin ? "/admin" : "/admin/problem/list", show: true },
  ].filter((it) => it.show),
)

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
      <h1 class="hello">{{ greeting }}，{{ userStore.user?.username }}</h1>
      <n-text v-if="today" depth="3" class="tagline">
        {{
          today.classes.length ? `今天 ${today.classes.length} 个班上过课` : "今天还没有班在上课"
        }}
      </n-text>
    </section>

    <section v-if="today?.classes.length" class="card">
      <h3>今天的课</h3>
      <div v-for="row in today.classes" :key="row.className" class="class-row">
        <div class="class-head">
          <b class="class-name">{{ classLabel(row.className) }}</b>
          <span class="state" :class="{ live: stateOf(row).live }">{{ stateOf(row).text }}</span>
          <span class="muted">{{ metaOf(row) }}</span>
          <span class="spacer"></span>
          <n-button :type="stateOf(row).live ? 'primary' : 'default'" @click="openBoard(row)">
            课堂看板
          </n-button>
        </div>
        <div v-if="row.problems.length" class="minis">
          <router-link
            v-for="problem in row.problems"
            :key="problem.problemDisplayId"
            :to="`/problem/${problem.problemDisplayId}`"
            class="mini"
            :title="`${problem.problemDisplayId} ${problem.title}：${problem.userCount} 人交过，${problem.acceptedCount} 人做对`"
          >
            <span>
              <b class="num">{{ problem.problemDisplayId }}</b>
              <span class="muted num mini-count">
                {{ problem.acceptedCount }}/{{ row.rosterCount }}</span
              >
            </span>
            <i>
              <b
                :style="{
                  width: `${row.rosterCount ? (problem.acceptedCount / row.rosterCount) * 100 : 0}%`,
                }"
              ></b>
            </i>
          </router-link>
        </div>
      </div>
    </section>

    <div class="shortcuts">
      <n-button v-for="it in shortcuts" :key="it.to" size="large" @click="router.push(it.to)">
        {{ it.label }}
      </n-button>
    </div>

    <div
      v-for="item in pinned"
      :key="item.id"
      class="card pinned"
      role="button"
      tabindex="0"
      @click="openAnnouncement(item)"
      @keyup.enter="openAnnouncement(item)"
    >
      <n-tag type="warning" size="small" :bordered="false">置顶</n-tag>
      <b>{{ item.title }}</b>
      <span class="spacer"></span>
      <router-link to="/announcement" class="muted" @click.stop>公告 →</router-link>
    </div>

    <n-modal
      v-model:show="announcementShow"
      preset="card"
      :style="{ maxWidth: '70vw', maxHeight: '80vh' }"
      :content-style="{ overflow: 'auto' }"
      :title="announcementTitle"
    >
      <div v-html="announcementContent"></div>
    </n-modal>
  </div>
</template>

<style scoped>
.home {
  max-width: var(--oj-page-width);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.hero {
  margin: 16px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hello {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
}

.tagline {
  font-size: 15px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 20px;
  border-radius: var(--oj-radius);
  border: 1px solid v-bind("theme.dividerColor");
}

.card h3 {
  margin: 0 0 6px;
  font-size: 17px;
}

.class-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.class-row:first-of-type {
  border-top: 0;
}

.class-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.class-name {
  font-size: 16px;
}

.state {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 13px;
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor3");
}

.state.live {
  color: v-bind("theme.successColor");
  font-weight: 600;
}

.muted {
  font-size: 14px;
  color: v-bind("theme.textColor3");
  text-decoration: none;
}

.spacer {
  flex: 1 1 auto;
}

.minis {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.mini {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  min-width: 90px;
  font-size: 13px;
  color: inherit;
  text-decoration: none;
}

.mini i {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: v-bind("theme.actionColor");
  overflow: hidden;
}

.mini i b {
  display: block;
  height: 5px;
  background: v-bind("theme.successColor");
}

.num {
  font-variant-numeric: tabular-nums;
}

.mini-count {
  margin-left: 4px;
  font-size: 13px;
}

.shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pinned {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  cursor: pointer;
}

.pinned:hover {
  border-color: v-bind("theme.primaryColor");
}
</style>
