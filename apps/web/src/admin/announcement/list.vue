<script setup lang="ts">
import PageHeader from "admin/components/PageHeader.vue"
import { NSwitch, useThemeVars } from "naive-ui"
import { RouterLink } from "vue-router"
import Pagination from "shared/components/Pagination.vue"
import { parseTime } from "utils/functions"
import type { AdminAnnouncementListItem } from "utils/types"
import { editAnnouncement, getAnnouncement, getAnnouncementList } from "../api"
import Actions from "./components/Actions.vue"

const message = useMessage()
const total = ref(0)
const query = reactive({
  limit: 10,
  page: 1,
})
const announcements = ref<AdminAnnouncementListItem[]>([])

/**
 * 后台公告列表（设计稿「后台公告」AnnAdmin）：一行一条，标题（置顶挂标，公告 / 更新淡淡写在后面）、
 * 发布、改过、学生看得到；「编辑」常驻，置顶 / 删除收进 ⋯。ID、作者（都是同一个人）、
 * 精确到秒的两列时间拿掉
 */
const theme = useThemeVars()

const columns: DataTableColumn<AdminAnnouncementListItem>[] = [
  {
    title: "标题",
    key: "title",
    minWidth: 300,
    render: (row) =>
      h("span", { class: "title-cell" }, [
        h(
          RouterLink,
          {
            class: "title-link",
            to: { name: "admin announcement edit", params: { announcementID: row.id } },
          },
          () => row.title,
        ),
        row.top ? h("span", { class: "top" }, "置顶") : null,
        h("span", { class: "muted small" }, row.tag),
      ]),
  },
  {
    title: "发布",
    key: "createTime",
    width: 120,
    render: (row) => h("span", { class: "num" }, parseTime(row.createTime, "YYYY-MM-DD")),
  },
  {
    title: "改过",
    key: "lastUpdateTime",
    width: 120,
    render: (row) => {
      const created = parseTime(row.createTime, "YYYY-MM-DD")
      const updated = parseTime(row.lastUpdateTime, "YYYY-MM-DD")
      return h("span", { class: "num muted" }, updated === created ? "—" : updated)
    },
  },
  {
    title: "学生看得到",
    key: "visible",
    width: 100,
    render: (row) =>
      h(NSwitch, {
        value: row.visible,
        size: "small",
        rubberBand: false,
        onUpdateValue: () => toggle(row, "visible"),
      }),
  },
  {
    title: "",
    key: "actions",
    width: 110,
    render: (row) =>
      h(Actions, {
        announcementID: row.id,
        top: row.top,
        onDeleted: listAnnouncements,
        onToggleTop: () => toggle(row, "top"),
      }),
  },
]

// 列表响应不含 content（正文是 8MB 上限的富文本），而更新接口要求 content 必填 ——
// 拿列表里那行直接回传会 400。所以先取回整条再改。
async function toggle(announcement: AdminAnnouncementListItem, field: "visible" | "top") {
  try {
    const full = await getAnnouncement(announcement.id)
    await editAnnouncement({
      id: full.id,
      title: full.title,
      tag: full.tag,
      content: full.content,
      visible: field === "visible" ? !full.visible : full.visible,
      top: field === "top" ? !full.top : full.top,
    })
    if (field === "top") listAnnouncements()
    else announcement.visible = !full.visible
  } catch {
    message.error("没改成，刷新一下再试")
  }
}

async function listAnnouncements() {
  const offset = (query.page - 1) * query.limit
  const res = await getAnnouncementList(offset, query.limit)
  announcements.value = res.results
  total.value = res.total
}

onMounted(listAnnouncements)
watch(query, listAnnouncements, { deep: true })
</script>

<template>
  <PageHeader title="公告">
    <template #actions>
      <n-button type="primary" @click="$router.push({ name: 'admin announcement create' })">
        写一条公告
      </n-button>
    </template>
  </PageHeader>
  <n-data-table class="ann-table" :columns="columns" :data="announcements" />
  <Pagination :total="total" v-model:limit="query.limit" v-model:page="query.page" />
</template>

<style scoped>
.ann-table :deep(.title-cell) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ann-table :deep(.title-link) {
  color: inherit;
  font-weight: 500;
  text-decoration: none;
}

.ann-table :deep(.title-link:hover) {
  color: v-bind("theme.primaryColor");
  text-decoration: underline;
}

.ann-table :deep(.top) {
  font-size: 12px;
  padding: 0 6px;
  border-radius: 3px;
  color: v-bind("theme.warningColor");
  background: v-bind("theme.actionColor");
}

.ann-table :deep(.muted) {
  color: v-bind("theme.textColor3");
}

.ann-table :deep(.small) {
  font-size: 12px;
}

.ann-table :deep(.num) {
  font-variant-numeric: tabular-nums;
}
</style>
