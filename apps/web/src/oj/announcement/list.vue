<script lang="ts" setup>
import { useThemeVars } from "naive-ui"
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
const theme = useThemeVars()

const query = reactive({
  limit: 10,
  page: 1,
})

async function showContent(announcement: AnnouncementListItem) {
  const res = await getAnnouncement(announcement.id)
  toggleShow(true)
  title.value = announcement.title
  content.value = res.content
}
const announcements = ref<AnnouncementListItem[]>([])
const loaded = ref(false)

async function listAnnouncements() {
  const offset = (query.page - 1) * query.limit
  const res = await getAnnouncementList(offset, query.limit)
  total.value = res.total
  announcements.value = res.results
  loaded.value = true
}

onMounted(listAnnouncements)
watch(query, listAnnouncements, { deep: true })
</script>
<template>
  <div class="page oj-page">
    <h2>公告</h2>
    <div class="table">
      <div class="tr th">
        <span>公告标题</span>
        <span>标签</span>
        <span>发布时间</span>
        <span>发布人</span>
      </div>
      <div
        v-for="row in announcements"
        :key="row.id"
        class="tr"
        role="link"
        tabindex="0"
        @click="showContent(row)"
        @keyup.enter="showContent(row)"
      >
        <TitleWithTag :title="row.title" :top="row.top" />
        <span
          ><n-tag size="small">{{ row.tag || "公告" }}</n-tag></span
        >
        <span class="muted num">{{ parseTime(row.createTime) }}</span>
        <span class="muted">{{ row.createdBy.username }}</span>
      </div>
      <div v-if="loaded && !announcements.length" class="empty muted">还没有公告</div>
    </div>
    <Pagination v-model:limit="query.limit" v-model:page="query.page" :total="total" />
  </div>
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

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--oj-gap);
}

h2 {
  margin: 0;
  font-size: var(--oj-fs-title);
}

.muted {
  color: v-bind("theme.textColor3");
}

.num {
  font-variant-numeric: tabular-nums;
}

.table {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  overflow: hidden;
}

.tr {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) 80px 170px 120px;
  align-items: center;
  gap: 14px;
  min-height: var(--oj-row-h-roomy);
  padding: 0 var(--oj-pad-x);
  font-size: var(--oj-fs-body);
  border-bottom: 1px solid v-bind("theme.dividerColor");
  cursor: pointer;
}

.tr > .muted {
  font-size: var(--oj-fs-sec);
}

.tr:last-child {
  border-bottom: 0;
}

.tr:not(.th):hover {
  background: v-bind("theme.hoverColor");
}

.th {
  min-height: var(--oj-head-h);
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
  cursor: default;
}

.empty {
  padding: 32px var(--oj-pad-x);
}

@media (max-width: 760px) {
  .tr {
    grid-template-columns: 1fr auto;
  }

  .tr > :nth-child(2),
  .tr > :nth-child(4) {
    display: none;
  }
}
</style>
