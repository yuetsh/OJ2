<script lang="ts">
import type { LearnBoardStudent } from "utils/types"

/** 读过这课的一个人，和他在这道配套题上的情况（一次没交是 null） */
export interface ProblemReader {
  userId: number
  username: string
  state: LearnBoardStudent["problems"][number] | null
}
</script>

<script setup lang="ts">
import { NText } from "naive-ui"
import { parseTime } from "utils/functions"
import UserName from "shared/components/UserName.vue"
import { useBreakpoints } from "shared/composables/breakpoints"

/**
 * 一道配套题，读过这课的人各自做没做对。数据就是方块格那份，不另外请求。
 * 交过没对的排最前（老师点进来是找卡住的人），其次一次没交的，做对的垫底。
 */
const props = defineProps<{ displayId: string; people: ProblemReader[] }>()
const router = useRouter()
const { isMobile } = useBreakpoints()

function rank(row: ProblemReader) {
  if (!row.state) return 1
  return row.state.solved ? 2 : 0
}

const rows = computed(() => [...props.people].sort((a, b) => rank(a) - rank(b)))

function renderResult(row: ProblemReader) {
  if (!row.state) return h(NText, { depth: 3 }, () => "没交")
  return row.state.solved
    ? h(NText, { type: "success" }, () => "做对了")
    : h(NText, { type: "error" }, () => `交了 ${row.state!.submissions} 次还没对`)
}

/** 提交列表按这个人、这道题筛好，新标签页打开，后台这页不动 */
function renderLink(row: ProblemReader) {
  if (!row.state) return null
  const { href } = router.resolve({
    path: "/submission",
    query: { problem: props.displayId, username: row.username, exactUsername: "1" },
  })
  return h("a", { href, target: "_blank", class: "link" }, "看提交")
}

const desktopColumns: DataTableColumn<ProblemReader>[] = [
  {
    title: "学生",
    key: "username",
    width: 150,
    render: (row) => h(UserName, { username: row.username }),
  },
  { title: "结果", key: "result", width: 150, render: renderResult },
  {
    title: "最后提交",
    key: "lastSubmitAt",
    width: 150,
    render: (row) =>
      row.state ? parseTime(row.state.lastSubmitAt, "YYYY年M月D日") : h(NText, { depth: 3 }, "-"),
  },
  { title: "", key: "link", render: renderLink },
]

const mobileColumns: DataTableColumn<ProblemReader>[] = [
  {
    title: "学生",
    key: "username",
    render: (row) =>
      h("div", { class: "m-line" }, [
        h(UserName, { username: row.username }),
        h("span", { class: "m-right" }, [renderResult(row), renderLink(row)]),
      ]),
  },
]

const columns = computed(() => (isMobile.value ? mobileColumns : desktopColumns))
</script>

<template>
  <n-data-table
    striped
    :columns="columns"
    :data="rows"
    :row-key="(row: ProblemReader) => row.userId"
    size="small"
    :pagination="rows.length > 10 ? { pageSize: 10 } : false"
  />
</template>

<style scoped>
:deep(.link) {
  color: #18a058;
  text-decoration: none;
}
:deep(.link:hover) {
  text-decoration: underline;
}
:deep(.m-line) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
:deep(.m-right) {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}
</style>
