<script setup lang="ts">
import type { AdminContestListItem } from "@oj2/contract"
import PageHeader from "admin/components/PageHeader.vue"
import { NSwitch, useThemeVars } from "naive-ui"
import ContestTitle from "shared/components/ContestTitle.vue"
import Pagination from "shared/components/Pagination.vue"
import { CONTEST_STATUS } from "utils/constants"
import { parseTime } from "utils/functions"
import { editContest, getContestList } from "../api"
import Actions from "./components/Actions.vue"

/**
 * 后台比赛列表（设计稿「比赛重设计」CtAdminList）。一行一场：比赛名（期中 / 期末挂标，
 * 要密码的带锁）、开始时间和多长、状态、几道题、几人参加、出卷人、学生看得到；
 * 操作「编辑」「成绩 / 全班情况」「复制一份」「在前台看」直接摆出来。按开始时间排 —— 原来按创建时间，复制出来的旧比赛
 * 会跑到最前面。ID、标签、类型三列拿掉（标签只在期中 / 期末时挂出来，类型就是那把锁）
 */
const theme = useThemeVars()
const contests = ref<AdminContestListItem[]>([])
const total = ref(0)
const query = reactive({
  limit: 10,
  page: 1,
  keyword: "",
})

function toggleVisible(contest: AdminContestListItem) {
  contest.visible = !contest.visible
  editContest(contest)
}

/** 多长：一节课的写分钟 / 小时，挂好几天的练习写天 */
function duration(row: AdminContestListItem) {
  const minutes = Math.round((Date.parse(row.endTime) - Date.parse(row.startTime)) / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 48 * 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
  }
  return `${Math.round(minutes / 1440)} 天`
}

const EXAM_TAGS = ["期中", "期末"]

const columns: DataTableColumn<AdminContestListItem>[] = [
  {
    title: "比赛",
    key: "title",
    width: 260,
    render: (row) =>
      h("span", { class: "title-cell" }, [
        h(ContestTitle, { contest: row }),
        EXAM_TAGS.includes(row.tag) ? h("span", { class: "exam" }, row.tag) : null,
      ]),
  },
  {
    title: "开始 · 多长",
    key: "start_time",
    width: 200,
    render: (row) =>
      h("span", { class: "num" }, [
        parseTime(row.startTime, "YYYY-MM-DD HH:mm"),
        h("span", { class: "muted" }, ` · ${duration(row)}`),
      ]),
  },
  {
    title: "状态",
    key: "status",
    width: 72,
    render: (row) =>
      h(
        "span",
        { class: row.status === "0" ? "live" : row.status === "-1" ? "muted" : "" },
        row.status === "-1"
          ? "结束了"
          : row.status === "0"
            ? "进行中"
            : CONTEST_STATUS[row.status].name,
      ),
  },
  { title: "题", key: "problemCount", width: 56 },
  {
    title: "参加",
    key: "participantCount",
    width: 64,
    render: (row) => (row.participantCount ? String(row.participantCount) : "—"),
  },
  {
    title: "出卷",
    key: "created_by",
    width: 84,
    ellipsis: { tooltip: true },
    render: (row) => row.createdBy.username,
  },
  {
    title: "学生看得到",
    key: "visible",
    width: 96,
    render: (row) =>
      h(NSwitch, {
        value: row.visible,
        size: "small",
        rubberBand: false,
        onUpdateValue: () => toggleVisible(row),
      }),
  },
  {
    title: "",
    key: "actions",
    minWidth: 270,
    render: (row) => h(Actions, { contest: row }),
  },
]

async function listContests() {
  const offset = (query.page - 1) * query.limit
  const res = await getContestList(offset, query.limit, query.keyword)
  contests.value = res.results
  total.value = res.total
}
onMounted(listContests)
watch(() => [query.page, query.limit], listContests)
watchDebounced(() => query.keyword, listContests, {
  debounce: 500,
  maxWait: 1000,
})
</script>

<template>
  <PageHeader title="比赛">
    <template #actions>
      <n-button type="primary" @click="$router.push({ name: 'admin contest create' })">
        新建比赛
      </n-button>
    </template>
    <template #filters>
      <n-input v-model:value="query.keyword" placeholder="比赛名" clearable style="width: 220px" />
    </template>
  </PageHeader>
  <n-data-table class="contest-table" :columns="columns" :data="contests" />
  <Pagination :total="total" v-model:limit="query.limit" v-model:page="query.page" />
</template>

<style scoped>
.contest-table :deep(.title-cell) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.contest-table :deep(.exam) {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 400;
  color: v-bind("theme.errorColor");
  background: v-bind("theme.actionColor");
}

.contest-table :deep(.num) {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.contest-table :deep(.muted) {
  color: v-bind("theme.textColor3");
}

.contest-table :deep(.live) {
  color: v-bind("theme.successColor");
  font-weight: 600;
}
</style>
