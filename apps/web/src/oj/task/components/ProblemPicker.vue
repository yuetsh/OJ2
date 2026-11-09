<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { LESSON_MODE_LABEL, lessonNeeds, type LessonLanguage, type LessonMode, type Tag } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { getProblemList, getProblemTagList } from 'shared/api'
import { useTone } from 'shared/composables/tone'
import { LANGUAGE_SHOW_VALUE } from 'utils/constants'
import type { ProblemRow } from 'utils/types'
import ProblemTypeTag from 'oj/problem/components/ProblemTypeTag.vue'
import ProblemBrief from './ProblemBrief.vue'

/**
 * 任务页布置任务的「选题」弹框：左边按知识点分，右边勾题，底下按勾的先后排成这节课的顺序。
 * 只列这节课做得了的题（左栏题数也这样数）：要写代码的只列能用这次作业的语言交的，
 * 要画流程图的只列打开了画流程图的。不用再一个个记题号。
 * 点「布置」直接存，和在输入框里敲题号回车是一回事。
 * 每行的「查看」在弹框里把列表换成题面，看完返回还在原来的位置，不用离开弹框
 */
const props = defineProps<{
  /** 打开时已经在框里的题（题号 + 知道的话带上题名） */
  initial: { id: string; title?: string }[]
  saving: boolean
  /** pick = 只把选好的题交回去（后台改一节时用），不直接布置 */
  mode?: 'assign' | 'pick'
}>()
const show = defineModel<boolean>('show', { required: true })
const language = defineModel<LessonLanguage>('language', { required: true })
/** 这节课做什么（写代码 / 画流程图 / 先画再写），和任务页上那个下拉是同一个 */
const lessonMode = defineModel<LessonMode>('lessonMode', { required: true })
const needs = computed(() => lessonNeeds(lessonMode.value))
/** 只画流程图不看语言 */
const languageFilter = computed(() => (needs.value.code ? language.value : ''))
const emit = defineEmits<{ confirm: [ids: string[]] }>()

const theme = useThemeVars()
const tone = useTone()

const LESSON_LANGUAGES: LessonLanguage[] = ['Python', 'C', 'C++', 'SQL']
const LESSON_MODE_OPTIONS = (['code', 'both', 'flowchart'] as const).map((value) => ({ label: LESSON_MODE_LABEL[value], value }))
const languageOptions = LESSON_LANGUAGES.map((value) => ({ label: LANGUAGE_SHOW_VALUE[value], value }))
const SORTS = [
  { label: '最新出的', value: '' },
  { label: '做过的人最多', value: '-submission_number' },
]
const PAGE_SIZE = 100
/** 老师挑的题，必会题是按课堂用得最多挑出来的，放在知识点前面 */
const MUST_DO = '必会题'

const tags = ref<Tag[]>([])
const tag = ref('')
const keyword = ref('')
const sort = ref('')
const page = ref(1)
const rows = ref<ProblemRow[]>([])
const total = ref(0)
const loading = ref(false)

/** 勾的先后就是这节课的顺序 */
const picked = ref<{ id: string; title?: string }[]>([])
const pickedIndex = computed(() => new Map(picked.value.map((p, i) => [p.id.toLowerCase(), i])))

const knowledge = computed(() => tags.value.filter((t) => t.category === 'knowledge').sort((a, b) => b.problemCount - a.problemCount))
const mustDo = computed(() => tags.value.find((t) => t.name === MUST_DO) ?? null)
const allCount = ref(0)

async function loadTags() {
  const list = await getProblemTagList(languageFilter.value, needs.value.draw)
  tags.value = list
  // 换了语言，原来选的知识点在这个语言下可能一道都没有
  if (tag.value && !list.some((t) => t.name === tag.value)) tag.value = ''
}

let seq = 0
async function loadRows() {
  const mine = ++seq
  loading.value = true
  try {
    const res = await getProblemList((page.value - 1) * PAGE_SIZE, PAGE_SIZE, {
      tag: tag.value,
      keyword: keyword.value.trim(),
      sort: sort.value,
      language: languageFilter.value,
      ...(needs.value.draw ? { flowchart: '1' } : {}),
    })
    if (mine !== seq) return
    rows.value = res.results
    total.value = res.total
    if (!tag.value && !keyword.value.trim()) allCount.value = res.total
  } finally {
    if (mine === seq) loading.value = false
  }
}

const listRef = ref<HTMLElement | null>(null)
function reload() {
  page.value = 1
  listRef.value?.scrollTo({ top: 0 })
  loadRows()
}

watch(show, (open) => {
  if (!open) return
  picked.value = props.initial.map((p) => ({ ...p }))
  keyword.value = ''
  loadTags()
  reload()
})
watch([languageFilter, () => needs.value.draw], () => {
  if (!show.value) return
  loadTags()
  reload()
})
// 搜题号多半是记得那道题、不知道它在哪个知识点下，所以搜的是整个题库；点了知识点就不再搜
function pickTag(name: string) {
  keyword.value = ''
  tag.value = name
}
watch(keyword, (text) => {
  if (text.trim()) tag.value = ''
})
watch([tag, sort], reload)
watchDebounced(keyword, reload, { debounce: 300 })
watch(page, () => {
  listRef.value?.scrollTo({ top: 0 })
  loadRows()
})

function toggle(row: ProblemRow) {
  const key = row._id.toLowerCase()
  if (pickedIndex.value.has(key)) picked.value = picked.value.filter((p) => p.id.toLowerCase() !== key)
  else picked.value = [...picked.value, { id: row._id, title: row.title }]
}

/** 正在看题面的那道；null = 看列表 */
const viewing = ref<ProblemRow | null>(null)
const viewingOn = computed(() => (viewing.value ? pickedIndex.value.get(viewing.value._id.toLowerCase()) : undefined))
watch([show, tag, sort, page, languageFilter, () => needs.value.draw], () => (viewing.value = null))
watch(keyword, () => (viewing.value = null))

function remove(id: string) {
  picked.value = picked.value.filter((p) => p.id !== id)
}

const emptyText = computed(() => {
  if (!needs.value.code) return '没有能画流程图的题'
  const text = `没有能用 ${LANGUAGE_SHOW_VALUE[language.value]} 做的题`
  return needs.value.draw ? `${text}（还要能画流程图）` : text
})

const DIFFICULTY_TONE = { 简单: 'success', 中等: 'warning', 困难: 'error' } as const
function difficultyStyle(row: ProblemRow) {
  if (!row.difficulty) return {}
  const t = tone(DIFFICULTY_TONE[row.difficulty])
  return { color: t.color, background: t.background }
}

// n-modal 把内容挂到 body 下，<style> 里的 v-bind() 传不进去，颜色走根节点的内联变量
const vars = computed(() => ({
  // 宽度也写在这里：n-modal 的 preset card 上 scoped 的 class 宽度不生效
  width: 'min(1040px, calc(100vw - 32px))',
  '--text2': theme.value.textColor2,
  '--text3': theme.value.textColor3,
  '--divider': theme.value.dividerColor,
  '--hover': theme.value.hoverColor,
  '--action': theme.value.actionColor,
  '--primary': theme.value.primaryColor,
  '--success': theme.value.successColor,
  '--on-bg': tone('success').background,
  '--on-text': tone('success').color,
}))
</script>

<template>
  <n-modal v-model:show="show" preset="card" :style="vars" :bordered="false" :auto-focus="false" title="选题">
    <template #header-extra>
      <div class="head-extra">
        <n-select v-model:value="lessonMode" :options="LESSON_MODE_OPTIONS" aria-label="这节课做什么" size="small" class="mode" />
        <template v-if="needs.code">
          <span class="muted">用</span>
          <n-select v-model:value="language" :options="languageOptions" aria-label="用什么语言写" size="small" class="lang" />
        </template>
      </div>
    </template>

    <div class="body">
      <nav class="tags">
        <button class="tag" :class="{ on: tag === '' && !keyword.trim() }" @click="pickTag('')">
          <span>全部</span><span class="count">{{ allCount || '' }}</span>
        </button>
        <button v-if="mustDo" class="tag" :class="{ on: tag === MUST_DO }" @click="pickTag(MUST_DO)">
          <span>{{ MUST_DO }}</span
          ><span class="count">{{ mustDo.problemCount }}</span>
        </button>
        <div class="tag-head">知识点</div>
        <button v-for="t in knowledge" :key="t.id" class="tag" :class="{ on: tag === t.name }" @click="pickTag(t.name)">
          <span>{{ t.name }}</span
          ><span class="count">{{ t.problemCount }}</span>
        </button>
      </nav>

      <section class="main">
        <div class="filters">
          <n-input v-model:value="keyword" placeholder="搜题号或题目名" clearable class="search">
            <template #prefix><Icon icon="ph:magnifying-glass" /></template>
          </n-input>
          <n-select v-model:value="sort" :options="SORTS" class="sort" />
        </div>

        <div v-if="viewing" class="preview">
          <div class="preview-head">
            <n-button size="small" quaternary @click="viewing = null">
              <template #icon><Icon icon="ph:arrow-left-bold" /></template>
              返回
            </n-button>
            <span class="preview-title"
              ><span class="pid">{{ viewing._id }}</span> <b>{{ viewing.title }}</b></span
            >
            <n-button size="small" :type="viewingOn === undefined ? 'primary' : 'default'" @click="toggle(viewing)">
              {{ viewingOn === undefined ? '选这道' : `已选第 ${viewingOn + 1} 道 · 去掉` }}
            </n-button>
          </div>
          <div class="preview-body">
            <ProblemBrief :display-id="viewing._id" />
          </div>
        </div>
        <div v-show="!viewing" ref="listRef" class="list">
          <n-spin :show="loading" class="spin">
            <n-empty v-if="!loading && !rows.length" :description="emptyText" class="empty" />
            <!-- 「查看」是链接，不能塞进勾题的 button 里，两个并排放在一行 -->
            <div v-for="row in rows" :key="row.id" class="line" :class="{ on: pickedIndex.has(row._id.toLowerCase()) }">
              <button type="button" class="row" @click="toggle(row)">
                <span class="check">
                  <template v-if="pickedIndex.has(row._id.toLowerCase())">{{ pickedIndex.get(row._id.toLowerCase())! + 1 }}</template>
                </span>
                <span class="pid">{{ row._id }}</span>
                <span class="title">
                  <span class="title-text">{{ row.title }}</span>
                  <ProblemTypeTag v-if="row.allowFlowchart" kind="flowchart" />
                  <ProblemTypeTag v-if="row.hasAstRules" kind="ast" />
                </span>
                <span class="diff" :style="difficultyStyle(row)">{{ row.difficulty ?? '' }}</span>
                <span class="people">{{ row.solvedUsers }}/{{ row.triedUsers }}</span>
              </button>
              <n-button size="small" class="view" @click="viewing = row">查看</n-button>
            </div>
          </n-spin>
        </div>
        <div v-if="total > PAGE_SIZE && !viewing" class="pager">
          <n-pagination v-model:page="page" :page-size="PAGE_SIZE" :item-count="total" simple />
        </div>
      </section>
    </div>

    <template #footer>
      <div class="foot">
        <div class="picked">
          <span v-if="!picked.length" class="muted">还没选题</span>
          <span v-for="(p, i) in picked" :key="p.id" class="pick">
            <b>{{ i + 1 }}</b>
            <span>{{ p.id }}</span>
            <span v-if="p.title" class="pick-title">{{ p.title }}</span>
            <button type="button" class="x" :aria-label="`去掉 ${p.id}`" @click="remove(p.id)"><Icon icon="ph:x-bold" /></button>
          </span>
        </div>
        <n-button @click="show = false">取消</n-button>
        <n-button
          type="primary"
          :disabled="!picked.length && (mode === 'pick' || !initial.length)"
          :loading="saving"
          @click="
            emit(
              'confirm',
              picked.map((p) => p.id),
            )
          "
        >
          <template v-if="mode === 'pick'">{{ picked.length ? `用这 ${picked.length} 道` : '选好了' }}</template>
          <template v-else>{{ picked.length ? `布置这 ${picked.length} 道` : initial.length ? '清掉' : '布置' }}</template>
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.head-extra {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lang {
  width: 110px;
}

.mode {
  width: 116px;
}

.muted {
  color: var(--text3);
}

.body {
  display: flex;
  gap: 16px;
  height: min(560px, calc(100vh - 260px));
}

/* ---- 左栏：知识点 ---- */
/* 全部 + 必会题 + 十几个知识点要整列放下、不出滚动条：36px 一行时差 40px，「总是显示滚动条」
   的电脑上冒出一根。32px 一行在 1366×768（框高 508px）上是 493px */
.tags {
  flex: 0 0 168px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-right: 12px;
  border-right: 1px solid var(--divider);
}

.tag-head {
  margin: 8px 10px 2px;
  font-size: 13px;
  color: var(--text3);
}

.tag {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
  flex-shrink: 0;
}

.tag:hover {
  background: var(--hover);
}

.tag.on {
  background: var(--on-bg);
  color: var(--on-text);
  font-weight: 600;
}

.count {
  font-size: 13px;
  color: var(--text3);
  font-variant-numeric: tabular-nums;
}

.tag.on .count {
  color: inherit;
}

/* ---- 右边：题 ---- */
.main {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filters {
  display: flex;
  gap: 8px;
}

.search {
  flex: 1 1 0;
}

.sort {
  width: 150px;
}

.list {
  flex: 1 1 0;
  overflow-y: auto;
}

.spin {
  min-height: 100%;
}

.empty {
  padding: 60px 0;
}

.line {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--divider);
}

.line:hover {
  background: var(--hover);
}

.line.on {
  background: var(--on-bg);
}

.row {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 10px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}

.check {
  flex: 0 0 22px;
  height: 22px;
  border: 1.5px solid var(--text3);
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}

.line.on .check {
  border-color: var(--primary);
  background: var(--primary);
}

.pid {
  flex: 0 0 56px;
  font-variant-numeric: tabular-nums;
  color: var(--text2);
}

.title {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 13px;
}

.people {
  flex: 0 0 76px;
  text-align: right;
  font-size: 14px;
  color: var(--text3);
  font-variant-numeric: tabular-nums;
}

.view {
  flex: none;
  margin: 0 10px 0 4px;
}

.preview {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--divider);
}

.preview-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--divider);
}

.preview-title {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
}

.preview-title .pid {
  margin-right: 4px;
}

.preview-body {
  flex: 1 1 0;
  overflow-y: auto;
  padding: 12px 4px 12px 0;
}

.pager {
  display: flex;
  justify-content: flex-end;
}

/* ---- 底下：选好的，按先后 ---- */
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.picked {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pick {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 4px 0 10px;
  border-radius: 6px;
  background: var(--action);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  max-width: 260px;
}

.pick b {
  color: var(--text3);
}

.pick-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text2);
}

.x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text3);
  cursor: pointer;
  flex-shrink: 0;
}

.x:hover {
  background: var(--hover);
  color: inherit;
}

@media (max-width: 768px) {
  .body {
    flex-direction: column;
    height: calc(100vh - 280px);
  }

  .tags {
    flex: 0 0 auto;
    flex-direction: row;
    overflow-x: auto;
    padding: 0 0 8px;
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }

  .tag-head {
    display: none;
  }

  .people {
    display: none;
  }

  .foot {
    flex-wrap: wrap;
  }

  .picked {
    flex-basis: 100%;
  }
}
</style>
