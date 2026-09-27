<script setup lang="ts">
import { useRouteQuery } from "@vueuse/router"
import { NTag } from "naive-ui"
import { getContestList } from "oj/api"
import { duration, parseTime } from "utils/functions"
import type { Contest } from "utils/types"
import ContestTitle from "shared/components/ContestTitle.vue"
import Pagination from "shared/components/Pagination.vue"
import { useAuthModalStore } from "shared/store/authModal"
import { usePagination } from "shared/composables/pagination"
import { useUserStore } from "shared/store/user"
import { CONTEST_STATUS, ContestStatus, ContestType } from "utils/constants"

const router = useRouter()
const userStore = useUserStore()
const authStore = useAuthModalStore()

interface ContestQuery {
  keyword: string
  status: string
  tag: string
}

// 使用分页 composable
const { query, clearQuery } = usePagination<ContestQuery>({
  keyword: useRouteQuery("keyword", "").value,
  status: useRouteQuery("status", "").value,
  tag: useRouteQuery("tag", "").value,
})

const data = ref<Contest[]>([])
const total = ref(0)

const options: SelectOption[] = [
  { label: "全部", value: "" },
  { label: "未开始", value: "1" },
  { label: "进行中", value: "0" },
  { label: "已结束", value: "-1" },
]

const tags: SelectOption[] = [
  { label: "全部", value: "" },
  { label: "练习", value: "练习" },
  { label: "期中", value: "期中" },
  { label: "期末", value: "期末" },
]

const columns: DataTableColumn<Contest>[] = [
  {
    title: "状态",
    key: "status",
    width: 100,
    render: (row) =>
      h(
        NTag,
        { type: CONTEST_STATUS[row.status]["type"] },
        () => CONTEST_STATUS[row.status]["name"],
      ),
  },
  {
    title: "比赛",
    key: "title",
    minWidth: 360,
    render: (row) => h(ContestTitle, { contest: row }),
  },
  {
    title: "标签",
    key: "tag",
    width: 100,
    render: (row) => h(NTag, () => row.tag),
  },
  {
    title: "开始时间",
    key: "start_time",
    width: 180,
    render: (row) => parseTime(row.startTime),
  },
  {
    title: "比赛时长",
    key: "duration",
    width: 180,
    render: (row) => duration(row.startTime, row.endTime),
  },
]

async function listContests() {
  const offset = (query.page - 1) * query.limit
  const res = await getContestList({
    offset,
    limit: query.limit,
    keyword: query.keyword,
    status: query.status,
    tag: query.tag,
  })
  data.value = res.results
  total.value = res.total
}

function search(value: string) {
  query.keyword = value
}

function clear() {
  clearQuery()
}

onMounted(listContests)

// 监听搜索关键词变化（防抖）
watchDebounced(() => query.keyword, listContests, {
  debounce: 500,
  maxWait: 1000,
})

// 监听其他查询条件变化
watch(() => [query.page, query.limit, query.status, query.tag], listContests)

function openContest(row: Contest) {
  if (!userStore.isAuthed && row.contestType === ContestType.private) {
    authStore.openLoginModal()
  } else {
    router.push("/contest/" + row.id)
  }
}

function rowProps(row: Contest) {
  return {
    style: "cursor: pointer",
    onClick: () => openContest(row),
  }
}

// 进行中 / 即将开始的比赛单独拎到最上面：表格按开始时间倒序，一场开了一周的
// 练习赛会被后来建的比赛压到第二页去，学生找不着正在比的那一场
const active = ref<Contest[]>([])
const showActive = computed(
  () =>
    active.value.length > 0 && query.page === 1 && !query.keyword && !query.status && !query.tag,
)

async function listActive() {
  const base = { offset: 0, limit: 6, keyword: "", tag: "" }
  const [underway, upcoming] = await Promise.all([
    getContestList({ ...base, status: ContestStatus.underway }),
    getContestList({ ...base, status: ContestStatus.not_started }),
  ])
  active.value = [...underway.results, ...upcoming.results].slice(0, 6)
}

onMounted(listActive)

function activeTime(row: Contest) {
  if (row.status === ContestStatus.underway) {
    return `${parseTime(row.endTime, "M月D日 HH:mm")} 结束`
  }
  return `${parseTime(row.startTime, "M月D日 HH:mm")} 开始`
}
</script>
<template>
  <n-flex vertical size="large">
    <n-space>
      <n-form :show-feedback="false" label-placement="left" inline>
        <n-form-item label="比赛状态">
          <n-select style="width: 120px" :options="options" v-model:value="query.status" />
        </n-form-item>
        <n-form-item label="标签">
          <n-select style="width: 120px" :options="tags" v-model:value="query.tag" />
        </n-form-item>
      </n-form>
      <n-form :show-feedback="false" label-placement="left" inline>
        <n-form-item>
          <n-input
            style="width: 180px"
            clearable
            v-model:value="query.keyword"
            placeholder="比赛标题"
          />
        </n-form-item>
        <n-form-item>
          <n-flex :wrap="false">
            <n-button @click="search(query.keyword)">搜索</n-button>
            <n-button @click="clear" quaternary>重置</n-button>
          </n-flex>
        </n-form-item>
      </n-form>
    </n-space>
    <div v-if="showActive" class="active-grid">
      <div
        v-for="contest in active"
        :key="contest.id"
        class="active-card"
        :class="{ underway: contest.status === ContestStatus.underway }"
        @click="openContest(contest)"
      >
        <n-flex align="center" :size="8">
          <n-tag :type="CONTEST_STATUS[contest.status].type" size="small" :bordered="false">
            {{ CONTEST_STATUS[contest.status].name }}
          </n-tag>
          <n-text depth="3" class="active-meta">{{ contest.tag }}</n-text>
        </n-flex>
        <ContestTitle :contest="contest" class="active-title" />
        <n-text depth="3" class="active-meta">
          {{ activeTime(contest) }} · 时长 {{ duration(contest.startTime, contest.endTime) }}
        </n-text>
      </div>
    </div>
    <n-data-table :bordered="false" :columns="columns" :data="data" :row-props="rowProps" />
  </n-flex>
  <Pagination v-model:limit="query.limit" v-model:page="query.page" :total="total" />
</template>

<style scoped>
.active-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.active-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  cursor: pointer;
  transition: border-color 0.2s;
}

.active-card.underway {
  border-color: rgba(24, 160, 88, 0.5);
  background-color: rgba(24, 160, 88, 0.06);
}

.active-card:hover {
  border-color: #18a058;
}

.active-title {
  font-size: 16px;
  font-weight: 500;
}

.active-meta {
  font-size: 12px;
}
</style>
