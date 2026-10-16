<script setup lang="ts">
import { NSwitch, useThemeVars } from "naive-ui"
import Pagination from "shared/components/Pagination.vue"
import { usePagination } from "shared/composables/pagination"
import { parseTime } from "utils/functions"
import type { AdminProblemRow } from "utils/types"
import { errorMessage } from "utils/api"
import { batchSetProblemVisible, getProblemList, toggleProblemVisible } from "../api"
import Actions from "./components/Actions.vue"
import AddFromLibraryModal from "./components/AddFromLibraryModal.vue"
import { useRouteQuery } from "@vueuse/router"
import AuthorSelect from "shared/components/AuthorSelect.vue"
import type { DataTableRowKey } from "naive-ui"
import BatchTagModal from "./components/BatchTagModal.vue"
import CreateProblemMenu from "./components/CreateProblemMenu.vue"
import PageHeader from "admin/components/PageHeader.vue"
import ProblemTypeTag from "oj/problem/components/ProblemTypeTag.vue"
import { useBreakpoints } from "shared/composables/breakpoints"

/**
 * 后台题目列表（设计稿「后台题目列表」PlA / PlB）。一行一道题：题号、题目（点了就是编辑）、
 * 知识点、做对 / 做过的人数、出题人、创建日期、「学生看得到」开关，最右「编辑」+ ⋯。
 *
 * 原来 1366 宽的屏上「可见」开关和创建时间要横滚才看得到，出题人被截成三个字；
 * 内部 ID 和显示编号两列、难度、看不懂的「功能」图标列、反馈表情列都拿掉了。
 * 比赛题目列表（contestID）也用这一页，没有勾选、人数和「全部 / 看得到 / 藏着的」
 */
interface Props {
  contestID?: string
}

const props = defineProps<Props>()
const route = useRoute()
const router = useRouter()
const theme = useThemeVars()
const { isMobile } = useBreakpoints()

const title = computed(
  () =>
    ({
      "admin problem list": "题目列表",
      "admin contest problem list": "比赛题目列表",
    })[route.name as string],
)
const isContestProblemList = computed(() => route.name === "admin contest problem list")

const [show, toggleShow] = useToggle()
const { count, inc } = useCounter(0)
const total = ref(0)
const problems = ref<AdminProblemRow[]>([])

const selectedRowKeys = ref<DataTableRowKey[]>([])
const batchTagAction = ref<"add" | "remove">("add")
const [showBatchTag, toggleBatchTag] = useToggle(false)

const selectedProblemIds = computed(() => selectedRowKeys.value.map((key) => Number(key)))

const rowKey = (row: AdminProblemRow) => row.id

function chooseProblems(rowKeys: DataTableRowKey[]) {
  selectedRowKeys.value = rowKeys
}

function openBatchTag(action: "add" | "remove") {
  batchTagAction.value = action
  toggleBatchTag(true)
}

function onBatchTagDone() {
  selectedRowKeys.value = []
  listProblems()
}

const nextDisplayID = computed(() => {
  if (!isContestProblemList.value) return ""
  if (problems.value.length === 0) return "1"
  const ids = problems.value.map((p) => p._id)
  if (ids.every((id) => /^\d+$/.test(id))) {
    return String(Math.max(...ids.map((id) => parseInt(id))) + 1)
  }
  return ""
})

interface ProblemQuery {
  keyword: string
  author: string
  kind: "" | "code" | "sql"
  /** 1 = 学生看得到的，0 = 藏着的 */
  visible: "" | "1" | "0"
}

// 使用分页 composable
const { query, clearQuery } = usePagination<ProblemQuery>({
  keyword: useRouteQuery("keyword", "").value,
  author: useRouteQuery("author", "").value,
  kind: useRouteQuery<ProblemQuery["kind"]>("kind", "").value,
  visible: useRouteQuery<ProblemQuery["visible"]>("visible", "").value,
})

const counts = ref<{ all: number; visible: number; hidden: number } | null>(null)
// 手机上三个按钮放不下、「藏着的」被切掉：换小号，再不够就横着滑
const narrow = useMediaQuery("(max-width: 640px)")
const visibleTabs = computed(() => [
  { value: "" as const, label: "全部", count: counts.value?.all },
  { value: "1" as const, label: "学生看得到", count: counts.value?.visible },
  { value: "0" as const, label: "藏着的", count: counts.value?.hidden },
])

/**
 * 知识点：两个以内全摆，多了只摆第一个 + 「+N」，鼠标放上去看全部（P073 这类题挂了六个）。
 * 列宽只放得下两个，摆两个再加 +N 的话 +N 会被截掉
 */
function renderTags(tags: string[]) {
  if (!tags.length) return h("span", { class: "muted" }, "—")
  const shown = tags.length > 2 ? tags.slice(0, 1) : tags
  return h("span", { class: "tags", title: tags.join("、") }, [
    ...shown.map((tag) => h("span", { class: "tag", key: tag }, tag)),
    tags.length > shown.length
      ? h("span", { class: "muted more" }, `+${tags.length - shown.length}`)
      : null,
  ])
}

function renderTitle(row: AdminProblemRow) {
  const kinds = [
    row.isSql ? h(ProblemTypeTag, { kind: "sql" }) : null,
    row.allowFlowchart ? h(ProblemTypeTag, { kind: "flowchart" }) : null,
    row.hasAstRules ? h(ProblemTypeTag, { kind: "ast" }) : null,
  ]
  return h("span", { class: "title-cell" }, [
    h(
      "a",
      {
        class: "title-link",
        href: router.resolve(editRoute(row.id)).href,
        onClick: (event: MouseEvent) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey) return
          event.preventDefault()
          router.push(editRoute(row.id))
        },
      },
      row.title,
    ),
    ...kinds,
  ])
}

function editRoute(problemID: number) {
  return {
    name: isContestProblemList.value ? "admin contest problem edit" : "admin problem edit",
    params: isContestProblemList.value ? { contestID: props.contestID, problemID } : { problemID },
  }
}

const baseColumns: DataTableColumn<AdminProblemRow>[] = [
  {
    title: "题号",
    key: "_id",
    width: 70,
    render: (row) => h("span", { class: "did", title: `内部编号 ${row.id}` }, row._id),
  },
  // 题目定宽：p90 也就 12 个字加一两个类型标签。原来 minWidth 让它吃掉整行剩余空间（用户嫌空太多），
  // 剩下的宽度给最后的操作列
  { title: "题目", key: "title", width: 196, ellipsis: false, render: renderTitle },
  { title: "知识点", key: "tags", width: 158, render: (row) => renderTags(row.tags) },
  {
    title: "做对 / 做过",
    key: "users",
    width: 96,
    render: (row) =>
      row.triedUsers
        ? h("span", { class: "num" }, [
            String(row.solvedUsers),
            h("span", { class: "muted" }, ` / ${row.triedUsers}`),
          ])
        : h("span", { class: "muted" }, "没人做过"),
  },
  { title: "出题人", key: "username", width: 86, ellipsis: { tooltip: true } },
  {
    title: "创建",
    key: "create_time",
    width: 100,
    render: (row) => h("span", { class: "num muted" }, parseTime(row.createTime, "YYYY-MM-DD")),
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
        onUpdateValue: () => toggleVisible(row.id),
      }),
  },
  {
    title: "",
    key: "actions",
    minWidth: 240,
    render: (row) =>
      h(Actions, {
        problemID: row.id,
        problemDisplayID: row._id,
        triedUsers: row.triedUsers,
        onUpdated: listProblems,
      }),
  },
]

/**
 * 手机上一道题一张卡：题号 + 题目一行，知识点 / 人数 / 出题人 / 日期一行小字，操作按钮一行；
 * 「学生看得到」开关单独一列靠右，不用横着滑就能点到
 */
function renderMobileCard(row: AdminProblemRow) {
  const meta = [
    row.tags.length
      ? row.tags.slice(0, 2).join("、") + (row.tags.length > 2 ? ` +${row.tags.length - 2}` : "")
      : null,
    isContestProblemList.value
      ? null
      : row.triedUsers
        ? `做对 ${row.solvedUsers} / ${row.triedUsers}`
        : "没人做过",
    row.username,
    parseTime(row.createTime, "YYYY-MM-DD"),
  ].filter((it): it is string => !!it)
  return h("div", { class: "m-card" }, [
    h("div", { class: "m-head" }, [h("span", { class: "did" }, row._id), renderTitle(row)]),
    // 每一项自己不断开（「做对 8 / 14」折成两半看不懂），放不下整项换行
    h(
      "div",
      { class: "m-meta muted" },
      meta.map((text, i) => h("span", { class: "m-item", key: i }, i ? ` · ${text}` : text)),
    ),
    h(Actions, {
      problemID: row.id,
      problemDisplayID: row._id,
      triedUsers: row.triedUsers,
      onUpdated: listProblems,
    }),
  ])
}

const mobileColumns: DataTableColumn<AdminProblemRow>[] = [
  { title: "题目", key: "title", render: renderMobileCard },
  {
    title: "看得到",
    key: "visible",
    width: 72,
    align: "center",
    render: (row) =>
      h(NSwitch, {
        value: row.visible,
        rubberBand: false,
        onUpdateValue: () => toggleVisible(row.id),
      }),
  },
]

const columns = computed<DataTableColumn<AdminProblemRow>[]>(() => {
  const cols = isMobile.value ? mobileColumns : baseColumns
  return isContestProblemList.value
    ? cols.filter((it) => !("key" in it) || it.key !== "users")
    : [{ type: "selection" }, ...cols]
})

async function listProblems() {
  if (query.page < 1) query.page = 1
  const offset = (query.page - 1) * query.limit
  const res = await getProblemList(
    offset,
    query.limit,
    query.keyword,
    query.author,
    props.contestID,
    undefined,
    query.kind,
    props.contestID ? "" : query.visible,
  )
  total.value = res.total
  problems.value = res.results
  counts.value = res.counts
}

/** 勾了几道，一次让学生看得到 / 藏起来（lwp0201 一批 P0xx 题出完一起放出来就是这么用） */
const message = useMessage()
async function batchVisible(visible: boolean) {
  try {
    const { problemCount } = await batchSetProblemVisible(selectedProblemIds.value, visible)
    message.success(`${problemCount} 道题${visible ? "学生看得到了" : "藏起来了"}`)
    selectedRowKeys.value = []
    listProblems()
  } catch (error) {
    message.error(errorMessage(error))
  }
}

async function toggleVisible(problemID: number) {
  await toggleProblemVisible(problemID)
  problems.value = problems.value.map((it) => {
    if (it.id === problemID) {
      it.visible = !it.visible
    }
    return it
  })
  // 三个按钮上的数跟着变；停在「藏着的」时这道题也该从列表里走掉，但当场消失会让人以为没点上，下次刷新再说
  if (counts.value) {
    const now = problems.value.find((it) => it.id === problemID)?.visible
    counts.value = {
      ...counts.value,
      visible: counts.value.visible + (now ? 1 : -1),
      hidden: counts.value.hidden + (now ? -1 : 1),
    }
  }
}

const kindOptions = [
  { label: "全部题型", value: "" },
  { label: "编程题", value: "code" },
  { label: "SQL 题", value: "sql" },
]

function createProblem(kind: string) {
  router.push({
    name: isContestProblemList.value ? "admin contest problem create" : "admin problem create",
    params: isContestProblemList.value ? { contestID: props.contestID } : {},
    query: kind === "sql" ? { type: "sql" } : {},
  })
}

async function selectProblems() {
  toggleShow(true)
  inc()
}

onMounted(listProblems)

// 监听搜索关键词变化（防抖）
watchDebounced(() => query.keyword, listProblems, {
  debounce: 500,
  maxWait: 1000,
})

// 监听其他查询条件变化
watch(() => [query.page, query.limit, query.author, query.kind, query.visible], listProblems)
</script>

<template>
  <PageHeader
    :title="title ?? '题目列表'"
    :back="isContestProblemList ? { name: 'admin contest list' } : undefined"
  >
    <template #actions>
      <template v-if="!isContestProblemList">
        <CreateProblemMenu label="新建题目" primary @select="createProblem" />
      </template>
      <template v-else>
        <CreateProblemMenu label="新建比赛题目" @select="createProblem" />
        <n-button type="primary" @click="selectProblems">从题库中选择</n-button>
      </template>
    </template>
    <template #filters>
      <n-input
        v-model:value="query.keyword"
        placeholder="题号或题目名"
        clearable
        :style="{ width: isMobile ? '100%' : '220px' }"
        @clear="clearQuery"
      />
      <n-select
        v-if="!props.contestID"
        v-model:value="query.kind"
        :options="kindOptions"
        aria-label="题型"
        style="width: 120px"
      />
      <n-flex v-if="!props.contestID" align="center" :size="8">
        <n-text depth="3">出题人</n-text>
        <AuthorSelect v-model:value="query.author" all />
      </n-flex>
      <n-button-group v-if="!props.contestID" class="visible-tabs">
        <n-button
          v-for="tab in visibleTabs"
          :key="tab.value"
          :size="narrow ? 'small' : 'medium'"
          :type="query.visible === tab.value ? 'primary' : 'default'"
          :secondary="query.visible === tab.value"
          @click="query.visible = tab.value"
        >
          {{ tab.label }}
          <span v-if="tab.count !== undefined" class="tab-count">{{ tab.count }}</span>
        </n-button>
      </n-button-group>
    </template>
  </PageHeader>
  <div v-if="selectedProblemIds.length" class="batch-bar">
    <b>已选 {{ selectedProblemIds.length }} 道</b>
    <n-button size="small" @click="batchVisible(true)">让学生看得到</n-button>
    <n-button size="small" @click="batchVisible(false)">藏起来</n-button>
    <n-button size="small" @click="openBatchTag('add')">加知识点</n-button>
    <n-button size="small" @click="openBatchTag('remove')">去掉知识点</n-button>
    <div class="spacer"></div>
    <n-button size="small" quaternary @click="selectedRowKeys = []">取消选择</n-button>
  </div>
  <n-data-table
    striped
    class="problem-table"
    :columns="columns"
    :data="problems"
    :row-key="rowKey"
    :checked-row-keys="selectedRowKeys"
    @update:checked-row-keys="chooseProblems"
  />
  <Pagination :total="total" v-model:limit="query.limit" v-model:page="query.page" />
  <AddFromLibraryModal
    v-model:show="show"
    :count="count"
    :next-display-id="nextDisplayID"
    @change="listProblems"
  />
  <BatchTagModal
    v-model:show="showBatchTag"
    :problem-ids="selectedProblemIds"
    :action="batchTagAction"
    @done="onBatchTagDone"
  />
</template>

<style scoped>
.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid v-bind("theme.successColorSuppl");
  background: v-bind("theme.hoverColor");
  white-space: nowrap;
  flex-wrap: wrap;
}

.spacer {
  flex: 1 1 auto;
}

.visible-tabs {
  max-width: 100%;
  overflow-x: auto;
}

.tab-count {
  margin-left: 6px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

/* 表头不折行：「做对 / 做过」「学生看得到」折成两行时整张表头变高 */
.problem-table :deep(.n-data-table-th) {
  white-space: nowrap;
}

.problem-table :deep(.did) {
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.problem-table :deep(.title-cell) {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.problem-table :deep(.title-link) {
  color: inherit;
  font-weight: 500;
  text-decoration: none;
}

.problem-table :deep(.title-link:hover) {
  color: v-bind("theme.primaryColor");
  text-decoration: underline;
}

.problem-table :deep(.tags) {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
}

.problem-table :deep(.tag) {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 7px;
  border-radius: 3px;
  background: v-bind("theme.actionColor");
  font-size: 12px;
}

.problem-table :deep(.muted) {
  color: v-bind("theme.textColor3");
}

.problem-table :deep(.more) {
  font-size: 12px;
}

.problem-table :deep(.m-card) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.problem-table :deep(.m-head) {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.problem-table :deep(.m-meta) {
  font-size: 13px;
  line-height: 1.5;
}

.problem-table :deep(.m-item) {
  white-space: nowrap;
}

.problem-table :deep(.num) {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
