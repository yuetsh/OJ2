<script lang="ts" setup>
import { Icon } from '@iconify/vue'
import PageHeader from 'admin/components/PageHeader.vue'
import { useThemeVars } from 'naive-ui'
import { classLabel } from 'utils/classes'
import { useBackClose } from 'shared/composables/backClose'
import { useBreakpoints } from 'shared/composables/breakpoints'
import Pagination from 'shared/components/Pagination.vue'
import UserName from 'shared/components/UserName.vue'
import { parseTime } from 'utils/functions'
import type { AdminAiReport, AdminAiReportListItem } from 'utils/types'
import { getAIReportDetail, getAIReportList, pinAIReport } from '../api'
import { useListLoader } from 'shared/composables/listLoader'

// Markdown 连着整套代码高亮（两百多 KB），这里要等点开 / AI 写完才用得上，别让它拖慢页面
const Markdown = defineAsyncComponent(() => import('shared/components/Markdown.vue'))

/**
 * 后台 AI 报告（设计稿「智能分析重设计」AiAdmin）：左边一份一行（用户名、班级、时间、
 * 两行摘要），点哪份右边就是全文。原来是表格 + 弹框，看一份要点「查看」、关框、再点下一份。
 *
 * 「PIN」（固定让这个学生在前台看这一份）线上 697 份里一次都没用过，从每行的按钮和页头那条
 * 锁定名单，收成正文右上角一个开关「固定给学生看这份」。后端是切换语义：钉一份会顺手把这个学生
 * 别的那份取消，所以切完重拉列表
 */
const theme = useThemeVars()
const { isMobile } = useBreakpoints()

// 手机上左右两栏放不下：只列报告，点一份全文盖满整屏，按返回键回到列表
const detailOpen = ref(false)
useBackClose(detailOpen, isMobile)
watch(isMobile, (mobile) => {
  if (!mobile) detailOpen.value = false
})

function pick(id: number) {
  if (isMobile.value) detailOpen.value = true
  open(id)
}

const reports = ref<AdminAiReportListItem[]>([])
const total = ref(0)
// 前台「智能分析」看某个学生时的「AI 报告」按钮带着 ?username= 过来，直接筛到他
const route = useRoute()
const query = reactive({
  limit: 10,
  page: 1,
  username: typeof route.query.username === 'string' ? route.query.username : '',
})

const selectedId = ref<number | null>(null)
const detail = ref<AdminAiReport | null>(null)
const loadingDetail = ref(false)
const selected = computed(() => reports.value.find((r) => r.id === selectedId.value) ?? null)

const { track } = useListLoader()
async function listReports() {
  const offset = (query.page - 1) * query.limit
  const res = await track(getAIReportList(offset, query.limit, query.username))
  if (!res) return
  reports.value = res.results
  total.value = res.total
  // 第一次进来、或者翻页 / 搜索之后选中的那份不在这一页了：默认看第一份
  if (!res.results.some((r) => r.id === selectedId.value)) open(res.results[0]?.id ?? null)
}

async function open(id: number | null) {
  selectedId.value = id
  detail.value = null
  if (id === null) return
  loadingDetail.value = true
  try {
    const res = await getAIReportDetail(id)
    if (selectedId.value === id) detail.value = res
  } finally {
    loadingDetail.value = false
  }
}

async function togglePin() {
  if (!selected.value) return
  await pinAIReport(selected.value.id)
  await listReports()
}

/** 摘要里去掉 Markdown 的记号：粗体星号、标题井号，还有表格的竖线和分隔线 */
function excerpt(text: string) {
  return text
    .replace(/[*#>`|]+/g, ' ')
    .replace(/-{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

onMounted(listReports)
watch(() => [query.page, query.limit], listReports)
watchDebounced(
  () => query.username,
  () => {
    query.page = 1
    listReports()
  },
  { debounce: 500, maxWait: 1000 },
)
</script>

<template>
  <PageHeader title="AI 报告">
    <template #filters>
      <n-input v-model:value="query.username" clearable placeholder="用户名" class="search" />
      <n-text depth="3">共 {{ total }} 份</n-text>
    </template>
  </PageHeader>

  <n-empty v-if="!reports.length" description="没有报告" style="margin-top: 60px" />
  <div v-else class="layout">
    <div class="list-col">
      <div class="list">
        <button v-for="r in reports" :key="r.id" type="button" class="item" :class="{ on: r.id === selectedId }" @click="pick(r.id)">
          <span class="item-head">
            <UserName :username="r.username" />
            <span class="muted small">{{ r.className ? classLabel(r.className) : '' }}</span>
            <span v-if="r.isPinned" class="pinned">固定</span>
            <span class="spacer"></span>
            <span class="muted small num">{{ parseTime(r.createTime, 'MM-DD HH:mm') }}</span>
          </span>
          <span class="item-text">{{ excerpt(r.analysisExcerpt) }}</span>
        </button>
      </div>
      <Pagination :total="total" v-model:limit="query.limit" v-model:page="query.page" simple />
    </div>

    <div class="detail" :class="{ open: detailOpen }">
      <div v-if="isMobile" class="detail-bar">
        <n-button quaternary circle @click="detailOpen = false">
          <template #icon><Icon icon="ph:arrow-left" /></template>
        </n-button>
        <span>AI 报告</span>
      </div>
      <n-spin :show="loadingDetail">
        <template v-if="selected">
          <div class="detail-head">
            <UserName :username="selected.username" />
            <span class="muted">
              {{ selected.className ? classLabel(selected.className) + ' · ' : '' }}{{ parseTime(selected.createTime, 'YYYY-MM-DD HH:mm') }}
            </span>
            <span class="spacer"></span>
            <label class="pin">
              固定给学生看这份
              <n-switch :value="selected.isPinned" size="small" @update:value="togglePin" />
            </label>
          </div>
          <div class="body">
            <Markdown v-if="detail" :content="detail.analysis" />
          </div>
        </template>
      </n-spin>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.list-col {
  width: 340px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list {
  border: 1px solid v-bind('theme.dividerColor');
  border-radius: 8px;
  overflow: hidden;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid v-bind('theme.dividerColor');
  background: none;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.item:last-child {
  border-bottom: 0;
}

/* 斑马底纹，和后台其它列表一样 */
.item:nth-child(even) {
  background: v-bind('theme.tableColorStriped');
}

.item:hover {
  background: v-bind('theme.hoverColor');
}

.item.on {
  background: v-bind('theme.hoverColor');
  box-shadow: inset 3px 0 0 v-bind('theme.primaryColor');
}

.item-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  min-width: 0;
}

.item-text {
  font-size: 13px;
  line-height: 20px;
  color: v-bind('theme.textColor3');
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.pinned {
  font-size: 12px;
  color: v-bind('theme.warningColor');
}

.detail {
  flex: 1 1 auto;
  min-width: 0;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.pin {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}

.body {
  padding-top: 14px;
  font-size: 15px;
  line-height: 1.8;
}

.spacer {
  flex: 1 1 auto;
}

.muted {
  color: v-bind('theme.textColor3');
  font-size: 14px;
}

.small {
  font-size: 12px;
}

.num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.search {
  width: 200px;
}

@media (max-width: 768px) {
  .search {
    flex: 1;
    width: auto;
    min-width: 0;
  }

  .list-col {
    width: 100%;
  }

  .detail {
    display: none;
  }

  .detail.open {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 2000;
    overflow-y: auto;
    padding: 0 16px 32px;
    background: v-bind('theme.bodyColor');
  }

  .detail-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 48px;
    margin: 0 -16px 12px;
    padding: 0 8px;
    font-weight: 600;
    border-bottom: 1px solid v-bind('theme.dividerColor');
    background: v-bind('theme.bodyColor');
  }

  .detail-head {
    flex-wrap: wrap;
    row-gap: 6px;
  }
}
</style>
