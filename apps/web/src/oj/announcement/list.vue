<script lang="ts" setup>
import { NTag } from "naive-ui"
import { getAnnouncement, getAnnouncementList } from "oj/api"
import Pagination from "shared/components/Pagination.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { parseTime } from "utils/functions"
import type { AnnouncementListItem } from "utils/types"
import TitleWithTag from "./components/TitleWithTag.vue"

const total = ref(0)
const content = ref("")
const title = ref("")
const [show, toggleShow] = useToggle(false)

const { isDesktop } = useBreakpoints()

const query = reactive({
  limit: 10,
  page: 1,
})
const columns: DataTableColumn<AnnouncementListItem>[] = [
  {
    key: "title",
    title: "公告标题",
    render: (row) => h(TitleWithTag, { title: row.title, top: row.top }),
    minWidth: 300,
  },
  {
    key: "tag",
    title: "标签",
    width: 100,
    render: (row) => h(NTag, () => row.tag || "公告"),
  },
  {
    key: "createTime",
    title: "发布时间",
    render: (row) => parseTime(row.createTime),
    width: 180,
  },
  {
    key: "username",
    title: "发布人",
    render: (row) => row.createdBy.username,
    width: 120,
  },
]
function rowProps(row: AnnouncementListItem) {
  return {
    style: "cursor: pointer",
    onclick: () => showContent(row),
  }
}

async function showContent(announcement: AnnouncementListItem) {
  const res = await getAnnouncement(announcement.id)
  toggleShow(true)
  title.value = announcement.title
  content.value = res.content
}
const announcements = ref<AnnouncementListItem[]>([])

async function listAnnouncements() {
  const offset = (query.page - 1) * query.limit
  const res = await getAnnouncementList(offset, query.limit)
  total.value = res.total
  announcements.value = res.results
}

onMounted(listAnnouncements)
watch(query, listAnnouncements, { deep: true })
</script>
<template>
  <n-data-table :bordered="false" :data="announcements" :columns="columns" :row-props="rowProps" />
  <Pagination v-model:limit="query.limit" v-model:page="query.page" :total="total" />
  <n-modal
    v-model:show="show"
    preset="card"
    :style="{ maxWidth: isDesktop && '70vw', maxHeight: '80vh' }"
    :content-style="{ overflow: 'auto' }"
    :title="title"
  >
    <div v-html="content"></div>
  </n-modal>
</template>
