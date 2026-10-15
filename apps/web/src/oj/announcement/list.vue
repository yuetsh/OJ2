<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { getAnnouncement, getAnnouncementList } from "oj/api"
import AdminLink from "shared/components/AdminLink.vue"
import NotFound from "shared/components/NotFound.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import { errorCode } from "utils/api"
import { parseTime, zonedParts, zonedYear } from "utils/functions"
import type { Announcement, AnnouncementListItem } from "utils/types"

/**
 * 公告：左边列表、右边全文，和后台 AI 报告一个排法。原来是一张四列的表、正文开弹框 ——
 * 「发布人」一列 24 条全是同一个人，弹框又让人一条条点开再关。
 * 选中哪条写在地址的 ?id= 上，首页的公告卡片直接链到这里那一条。
 * 手机上放不下两栏：没带 id 只列表，带了 id 只全文、顶上一个「全部公告」回去。
 * 一共才二十几条（四年 24 条），一次拉全，不分页
 */
const LIMIT = 100

const theme = useThemeVars()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const { isDesktop } = useBreakpoints()

const announcements = ref<AnnouncementListItem[]>([])
const loaded = ref(false)

onMounted(async () => {
  const res = await getAnnouncementList(0, LIMIT)
  announcements.value = res.results
  loaded.value = true
})

const queryId = computed(() => {
  const id = Number(route.query.id)
  return Number.isInteger(id) && id > 0 ? id : null
})

/** 桌面上没带 id 就看第一条（置顶的排最前）；手机上没带 id 就只看列表 */
const selectedId = computed(
  () => queryId.value ?? (isDesktop.value ? (announcements.value[0]?.id ?? null) : null),
)

function select(id: number) {
  router.replace({ query: { ...route.query, id } })
}

function backToList() {
  const { id: _, ...rest } = route.query
  router.replace({ query: rest })
}

const detail = ref<Announcement | null>(null)
const detailState = ref<"idle" | "loading" | "ok" | "missing" | "failed">("idle")
let seq = 0

async function loadDetail(id: number | null) {
  const mine = ++seq
  if (id === null) {
    detail.value = null
    detailState.value = "idle"
    return
  }
  detailState.value = "loading"
  try {
    const res = await getAnnouncement(id)
    if (mine !== seq) return
    detail.value = res
    detailState.value = "ok"
  } catch (err) {
    if (mine !== seq) return
    detail.value = null
    detailState.value = errorCode(err) === "announcement-not-found" ? "missing" : "failed"
  }
}

watch(selectedId, loadDetail, { immediate: true })

function dateText(value: string) {
  return parseTime(value, zonedParts(value)!.year === zonedYear() ? "M月D日" : "YYYY年M月D日")
}

/** 「2026年9月19日发布 · 9月23日改过」：同一天改的不写 */
function metaText(item: Announcement) {
  const created = parseTime(item.createTime, "YYYY年M月D日")
  const updated = parseTime(item.lastUpdateTime, "YYYY年M月D日")
  return updated === created
    ? `${created}发布`
    : `${created}发布 · ${dateText(item.lastUpdateTime)}改过`
}

/** 点正文里的图放大看：截图常常是整屏缩进正文栏的，字看不清 */
const zoomSrc = ref<string | null>(null)

function onContentClick(e: MouseEvent) {
  if (e.target instanceof HTMLImageElement) zoomSrc.value = e.target.src
}

onKeyStroke("Escape", () => {
  zoomSrc.value = null
})

const showList = computed(() => isDesktop.value || queryId.value === null)
const showReader = computed(() => isDesktop.value || queryId.value !== null)
</script>

<template>
  <div class="page oj-page">
    <div class="head">
      <h2>公告</h2>
      <template v-if="userStore.isSuperAdmin">
        <span class="grow"></span>
        <AdminLink
          v-if="showReader && detail"
          :to="{ name: 'admin announcement edit', params: { announcementID: detail.id } }"
        >
          编辑这条
        </AdminLink>
        <AdminLink to="/admin/announcement/create">发公告</AdminLink>
      </template>
    </div>

    <n-empty v-if="loaded && !announcements.length" description="还没有公告" class="blank" />

    <div v-else class="layout">
      <div v-if="showList" class="list">
        <button
          v-for="item in announcements"
          :key="item.id"
          type="button"
          class="item"
          :class="{ on: isDesktop && item.id === selectedId }"
          @click="select(item.id)"
        >
          <span class="item-title">
            <n-tag v-if="item.top" type="warning" size="small" :bordered="false">置顶</n-tag>
            <span class="ellipsis">{{ item.title }}</span>
          </span>
          <span class="muted num">{{ item.tag || "公告" }} · {{ dateText(item.createTime) }}</span>
        </button>
      </div>

      <article v-if="showReader" class="reader">
        <a v-if="!isDesktop" class="back" @click="backToList">‹ 全部公告</a>
        <NotFound
          v-if="detailState === 'missing'"
          title="这条公告不存在"
          hint="可能已经撤下了"
          to="/announcement"
          to-label="看全部公告"
        />
        <NotFound v-else-if="detailState === 'failed'" icon="ph:wifi-slash" title="公告没拉下来">
          <n-button type="primary" @click="loadDetail(selectedId)">再试一次</n-button>
        </NotFound>
        <n-spin v-else :show="detailState === 'loading'">
          <template v-if="detail">
            <header class="reader-head">
              <h3>
                <n-tag v-if="detail.top" type="warning" size="small" :bordered="false">
                  置顶
                </n-tag>
                {{ detail.title }}
              </h3>
              <span class="muted num">{{ detail.tag || "公告" }} · {{ metaText(detail) }}</span>
            </header>
            <div class="content" v-html="detail.content" @click="onContentClick"></div>
          </template>
          <div v-else class="placeholder"></div>
        </n-spin>
      </article>
    </div>

    <Teleport to="body">
      <div v-if="zoomSrc" class="zoom" @click="zoomSrc = null">
        <img :src="zoomSrc" alt="" />
      </div>
    </Teleport>
  </div>
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

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.grow {
  flex-grow: 1;
}

.blank {
  margin-top: 60px;
}

.layout {
  display: flex;
  gap: var(--oj-gap);
  align-items: flex-start;
}

.list {
  width: 340px;
  flex: none;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: var(--oj-radius);
  overflow: hidden;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 12px 16px;
  border: 0;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  background: none;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.item:last-child {
  border-bottom: 0;
}

.item:hover {
  background: v-bind("theme.hoverColor");
}

.item.on {
  background: v-bind("theme.hoverColor");
  box-shadow: inset 3px 0 0 v-bind("theme.primaryColor");
}

.item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: var(--oj-fs-body);
}

.ellipsis {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
}

.num {
  font-variant-numeric: tabular-nums;
}

.reader {
  flex: 1 1 auto;
  min-width: 0;
  padding: 20px var(--oj-pad-x) 28px;
  border-radius: var(--oj-radius);
  background: v-bind("theme.actionColor");
}

.back {
  display: inline-block;
  margin-bottom: 12px;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.reader-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 14px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

h3 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 20px;
}

/* 正文是后台富文本编辑器存的 HTML，和题面一样 16px，别缩 */
.content {
  padding-top: 14px;
  font-size: 16px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.content :deep(p) {
  margin: 0 0 8px;
}

/* 老编辑器把图的宽高写成了内联 style（width: 989px; height: 516px），
   宽度被 max-width 压窄、高度却还是原像素，图就扁了 —— 高度只能 !important 压过内联 */
.content :deep(img) {
  max-width: 100%;
  height: auto !important;
  cursor: zoom-in;
}

.content :deep(a) {
  color: v-bind("theme.primaryColor");
}

.zoom {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.8);
  cursor: zoom-out;
}

.zoom img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #fff;
}

.placeholder {
  min-height: 240px;
}

@media (max-width: 768px) {
  .list {
    width: 100%;
  }

  .reader {
    padding: 16px;
  }
}
</style>
