<script setup lang="ts">
import { NButton, NTag } from "naive-ui"
import Pagination from "shared/components/Pagination.vue"
import type { AdminProblemRow } from "utils/types"
import { batchTagProblems, getProblemList } from "admin/api"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useListLoader } from "shared/composables/listLoader"

interface Props {
  show: boolean
  tagId: number
  tagName: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  "update:show": [value: boolean]
  changed: []
}>()

const router = useRouter()
const message = useMessage()

const problems = ref<AdminProblemRow[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(10)
const keyword = ref("")

const { isMobile } = useBreakpoints()

const allColumns: DataTableColumn<AdminProblemRow>[] = [
  { title: "题号", key: "_id", width: 90 },
  {
    title: "题目",
    key: "title",
    minWidth: 200,
    render: (row) =>
      h(NButton, { text: true, type: "primary", onClick: () => goEdit(row) }, () => row.title),
  },
  {
    title: "学生看得到",
    key: "visible",
    width: 100,
    render: (row) =>
      h(NTag, { size: "small", bordered: false, type: row.visible ? "success" : "default" }, () =>
        row.visible ? "看得到" : "藏着",
      ),
  },
  {
    title: "",
    key: "actions",
    width: 90,
    render: (row) =>
      h(NButton, { size: "small", quaternary: true, onClick: () => removeTag(row) }, () => "摘掉"),
  },
]

// 手机上放不下四列：不摆「学生看得到」，题号收窄，题目吃剩下的宽度
const mobileColumns: DataTableColumn<AdminProblemRow>[] = [
  { ...allColumns[0], width: 64 } as DataTableColumn<AdminProblemRow>,
  { ...allColumns[1], minWidth: undefined } as DataTableColumn<AdminProblemRow>,
  { ...allColumns[3], width: 64 } as DataTableColumn<AdminProblemRow>,
]

const columns = computed(() => (isMobile.value ? mobileColumns : allColumns))

const { loading, track } = useListLoader()
async function listProblems() {
  if (page.value < 1) page.value = 1
  const offset = (page.value - 1) * limit.value
  const res = await track(
    getProblemList(offset, limit.value, keyword.value, "", undefined, props.tagId),
  )
  if (!res) return
  problems.value = res.results
  total.value = res.total
}

function close() {
  emit("update:show", false)
}

function goEdit(row: AdminProblemRow) {
  close()
  router.push({ name: "admin problem edit", params: { problemID: row.id } })
}

async function removeTag(row: AdminProblemRow) {
  await batchTagProblems([row.id], [props.tagName], "remove")
  message.success(`已移除「${row.title}」的标签`)
  emit("changed")
  // 移掉本页最后一条时退回上一页，交给下面的 watcher 重新拉取
  if (problems.value.length === 1 && page.value > 1) {
    page.value -= 1
  } else {
    listProblems()
  }
}

// 改搜索词就回到第一页
watch(keyword, () => (page.value = 1))

// 每次打开弹窗重置状态，拉取交给下面的 watcher
watch(
  () => props.show,
  (show) => {
    if (!show) return
    page.value = 1
    keyword.value = ""
  },
)

// 打开 / 翻页 / 改每页条数 / 改搜索词都走这里，防抖把同一批变更合并成一次请求
watchDebounced(
  () => [props.show, props.tagId, page.value, limit.value, keyword.value],
  () => {
    if (!props.show) return
    listProblems()
  },
  { debounce: 300, maxWait: 800 },
)
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="`标签「${tagName}」下的题目`"
    style="width: 720px"
    @close="close"
  >
    <n-flex vertical size="large">
      <n-flex justify="space-between" align="center">
        <span>共 {{ total }} 道题</span>
        <n-input
          v-model:value="keyword"
          :style="{ width: isMobile ? '160px' : '220px' }"
          placeholder="题号或题目名"
          clearable
        />
      </n-flex>
      <n-data-table :loading="loading" striped :columns="columns" :data="problems" />
      <Pagination :total="total" v-model:limit="limit" v-model:page="page" />
    </n-flex>
  </n-modal>
</template>
