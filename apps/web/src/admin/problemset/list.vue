<script setup lang="ts">
import PageHeader from "admin/components/PageHeader.vue"
import Pagination from "shared/components/Pagination.vue"
import { usePagination } from "shared/composables/pagination"
import { parseTime } from "utils/functions"
import type { AdminProblemSet } from "utils/types"
import { getProblemSetList, toggleProblemSetVisible } from "../api"
import { NButton, NSwitch, NTag, useThemeVars } from "naive-ui"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useListLoader } from "shared/composables/listLoader"

/**
 * 后台题单列表。难度、状态两列和筛选拿掉了（线上全是简单 / 活跃，「状态 + 可见」合成了「公开」），
 * 换成老师真正关心的：几道题、多少人加入 / 做完、布置到哪天。点一行进一屏编辑
 */
const router = useRouter()
const theme = useThemeVars()
const { isMobile } = useBreakpoints()
const total = ref(0)
const problemSets = ref<AdminProblemSet[]>([])

const { query, clearQuery } = usePagination<{ keyword: string }>({ keyword: "" })

function edit(row: AdminProblemSet) {
  router.push({ name: "admin problemset edit", params: { problemSetId: row.id } })
}

function renderTitle(row: AdminProblemSet) {
  return h(NButton, { text: true, onClick: () => edit(row) }, { default: () => row.title })
}

function renderAssigned(row: AdminProblemSet) {
  return row.assigning
    ? h(
        NTag,
        { type: "info", size: "small", bordered: false },
        { default: () => `到 ${parseTime(row.assignedUntil!, "M月D日")}` },
      )
    : "—"
}

function renderVisible(row: AdminProblemSet) {
  return h(NSwitch, {
    value: row.visible,
    size: isMobile.value ? "medium" : "small",
    rubberBand: false,
    onUpdateValue: () => toggleVisible(row.id),
  })
}

/** 手机上一个题单一张卡：名字一行（点了编辑），题数 · 加入 / 做完 · 奖章 · 创建者 · 日期一行小字 */
function renderMobileCard(row: AdminProblemSet) {
  const items = [
    `${row.problemsCount} 道题`,
    `${row.participantCount} 人加入 · ${row.completedCount} 人做完`,
    row.badgeCount ? `${row.badgeCount} 个奖章` : null,
    row.createdBy.username,
    parseTime(row.createTime, "YYYY-MM-DD"),
  ].filter((it): it is string => !!it)
  return h("div", { class: "m-card" }, [
    h("div", { class: "m-head" }, [renderTitle(row), row.assigning ? renderAssigned(row) : null]),
    h(
      "div",
      { class: "m-meta" },
      items.map((text, i) => h("span", { class: "m-item", key: i }, i ? ` · ${text}` : text)),
    ),
  ])
}

const mobileColumns: DataTableColumn<AdminProblemSet>[] = [
  { title: "题单", key: "title", render: renderMobileCard },
  { title: "公开", key: "visible", width: 72, align: "center", render: renderVisible },
]

const desktopColumns: DataTableColumn<AdminProblemSet>[] = [
  { title: "ID", key: "id", width: 70 },
  {
    title: "题单",
    key: "title",
    minWidth: 200,
    render: renderTitle,
  },
  { title: "题数", key: "problemsCount", width: 70 },
  {
    title: "加入 / 做完",
    key: "participantCount",
    width: 110,
    render: (row) => `${row.participantCount} / ${row.completedCount}`,
  },
  { title: "奖章", key: "badgeCount", width: 70 },
  {
    title: "布置",
    key: "assignedUntil",
    width: 130,
    render: renderAssigned,
  },
  {
    title: "创建者",
    key: "createdBy",
    width: 110,
    render: (row) => row.createdBy.username,
  },
  {
    title: "创建时间",
    key: "createTime",
    width: 120,
    render: (row) => parseTime(row.createTime, "YYYY-MM-DD"),
  },
  {
    title: "公开",
    key: "visible",
    width: 80,
    render: renderVisible,
  },
]

const columns = computed(() => (isMobile.value ? mobileColumns : desktopColumns))

const { loading, track } = useListLoader()
async function listProblemSets() {
  if (query.page < 1) query.page = 1
  const offset = (query.page - 1) * query.limit
  const res = await track(getProblemSetList(offset, query.limit, query.keyword))
  if (!res) return
  total.value = res.total
  problemSets.value = res.results
}

async function toggleVisible(problemSetId: number) {
  const updated = await toggleProblemSetVisible(problemSetId)
  problemSets.value = problemSets.value.map((it) => (it.id === problemSetId ? updated : it))
}

onMounted(listProblemSets)
watchDebounced(() => query.keyword, listProblemSets, { debounce: 500, maxWait: 1000 })
watch(() => [query.page, query.limit], listProblemSets)
</script>

<template>
  <PageHeader title="题单列表">
    <template #actions>
      <n-button type="primary" @click="router.push({ name: 'admin problemset create' })">
        新建题单
      </n-button>
    </template>
    <template #filters>
      <n-input
        v-model:value="query.keyword"
        placeholder="搜题单名字"
        clearable
        @clear="clearQuery"
        :style="{ width: isMobile ? '100%' : '220px' }"
      />
    </template>
  </PageHeader>
  <n-data-table
    :loading="loading"
    striped
    class="set-table"
    :columns="columns"
    :data="problemSets"
  />
  <Pagination :total="total" v-model:limit="query.limit" v-model:page="query.page" />
</template>

<style scoped>
.set-table :deep(.m-card) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.set-table :deep(.m-head) {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-weight: 500;
}

.set-table :deep(.m-meta) {
  font-size: 13px;
  line-height: 1.5;
  color: v-bind("theme.textColor3");
}

.set-table :deep(.m-item) {
  white-space: nowrap;
}
</style>
