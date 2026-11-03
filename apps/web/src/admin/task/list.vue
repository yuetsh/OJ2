<script setup lang="ts">
import { LESSON_MODE_LABEL, type AdminLesson, type AdminLessonList, type LessonMode } from '@oj2/contract'
import { useRouteQuery } from '@vueuse/router'
import PageHeader from 'admin/components/PageHeader.vue'
import { NButton, NPopconfirm, NTag, NTooltip, useThemeVars } from 'naive-ui'
import { dayStartOfDate } from 'oj/statistics/period'
import Pagination from 'shared/components/Pagination.vue'
import { useBreakpoints } from 'shared/composables/breakpoints'
import { useListLoader } from 'shared/composables/listLoader'
import { usePagination } from 'shared/composables/pagination'
import { useConfigStore } from 'shared/store/config'
import { errorMessage } from 'utils/api'
import { classLabel, groupClassOptions } from 'utils/classes'
import { LANGUAGE_SHOW_VALUE } from 'utils/constants'
import { parseTime } from 'utils/functions'
import { deleteAdminLesson, getAdminLessons } from '../api'
import LessonEditModal from './components/LessonEditModal.vue'

/**
 * 后台「课堂任务」：布置过的每一节课一行，新的在前。课堂任务上当场布置的都在这里，
 * 布置错了能改、删；任务页外上的课能补一节 —— 数据统计按布置切课，补了才认得到
 */
const router = useRouter()
const message = useMessage()
const theme = useThemeVars()
const configStore = useConfigStore()
const { isMobile } = useBreakpoints()

// 从任务页「布置过的课」进来带着 ?className=
const { query } = usePagination<{ className: string; teacher: string; mode: string }>({
  className: useRouteQuery('className', '').value,
  teacher: useRouteQuery('teacher', '').value,
  mode: useRouteQuery('mode', '').value,
})
const data = ref<AdminLessonList | null>(null)

const classOptions = computed(() => [{ label: '全部班级', value: '' }, ...groupClassOptions(configStore.config?.classList ?? [])])
const MODES: LessonMode[] = ['code', 'both', 'flowchart']
const modeOptions = [{ label: '全部做法', value: '' }, ...MODES.map((value) => ({ label: LESSON_MODE_LABEL[value], value }))]
const teacherOptions = computed(() => [
  { label: '全部老师', value: '' },
  ...(data.value?.teachers ?? []).map((teacher) => ({ label: teacher.name, value: String(teacher.id) })),
])

const { loading, track } = useListLoader()
async function list() {
  if (query.page < 1) query.page = 1
  const res = await track(
    getAdminLessons((query.page - 1) * query.limit, query.limit, {
      className: query.className,
      teacher: query.teacher ? Number(query.teacher) : null,
      mode: query.mode,
    }),
  )
  if (res) data.value = res
}
onMounted(list)
// 换了班级、老师、做法 usePagination 会把页码拨回 1，同一拍里只拉一次
watch(() => [query.page, query.limit, query.className, query.teacher, query.mode], list)

// ---- 改 / 补 / 删 ----
const editing = ref(false)
const editingLesson = ref<AdminLesson | null>(null)
function edit(lesson: AdminLesson | null) {
  editingLesson.value = lesson
  editing.value = true
}

async function remove(lesson: AdminLesson) {
  try {
    await deleteAdminLesson(lesson.id)
    message.success('删掉了')
    list()
  } catch (error) {
    message.error(errorMessage(error))
  }
}

/** 看统计：这个班、这几道题、那一整天 */
function statistics(lesson: AdminLesson) {
  const day = String(dayStartOfDate(lesson.day))
  router.push({
    name: 'statistics',
    query: {
      className: lesson.className,
      problem: lesson.problems.map((p) => p.problemDisplayId).join(' '),
      period: 'custom',
      from: day,
      to: day,
    },
  })
}

// ---- 列 ----
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function dayText(day: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const thisYear = parseTime(new Date(), 'YYYY') === String(y)
  return `${thisYear ? '' : `${y}年`}${m}月${d}日 ${weekday}`
}

function renderProblems(lesson: AdminLesson) {
  return h(
    'div',
    { class: 'probs' },
    lesson.problems.map((p) =>
      h(
        NTooltip,
        {},
        {
          trigger: () => h('span', { class: ['chip', { hidden: !p.visible }] }, p.problemDisplayId),
          default: () => (p.visible ? p.title : `${p.title}（已藏起来，统计里不算）`),
        },
      ),
    ),
  )
}

function renderDone(lesson: AdminLesson) {
  return lesson.classSize ? `${lesson.doneCount} / ${lesson.classSize}` : `${lesson.doneCount}`
}

function renderActions(lesson: AdminLesson) {
  const size = isMobile.value ? 'medium' : 'small'
  return h('div', { class: 'actions' }, [
    h(NButton, { size, secondary: true, onClick: () => edit(lesson) }, { default: () => '改' }),
    h(NButton, { size, onClick: () => statistics(lesson) }, { default: () => '看统计' }),
    h(
      NPopconfirm,
      { onPositiveClick: () => remove(lesson), positiveText: '删掉', negativeText: '不删' },
      {
        trigger: () => h(NButton, { size, type: 'error', tertiary: true }, { default: () => '删除' }),
        default: () => `删掉 ${classLabel(lesson.className)} ${dayText(lesson.day)} 这一节？学生的提交不受影响，数据统计里这节课改回按提交推断`,
      },
    ),
  ])
}

/** 三种做法各一个颜色，一眼分得开；写代码也写出来，不当默认值省掉 */
const MODE_TAG_TYPE: Record<LessonMode, 'default' | 'info' | 'warning'> = { code: 'default', both: 'info', flowchart: 'warning' }

/** 「写代码 C语言」「先画再写 Python」「画流程图」：画流程图不用语言 */
function renderWay(lesson: AdminLesson) {
  return h('div', { class: 'way' }, [
    h(NTag, { size: 'small', bordered: false, type: MODE_TAG_TYPE[lesson.mode] }, { default: () => LESSON_MODE_LABEL[lesson.mode] }),
    lesson.language ? h('span', { class: 'way-lang' }, LANGUAGE_SHOW_VALUE[lesson.language]) : null,
  ])
}

/** 手机上一节课一张卡：日子 · 时刻 · 班级一行，做什么一行，题号一行，老师 · 做完一行小字，操作一行 */
function renderMobileCard(lesson: AdminLesson) {
  return h('div', { class: 'm-card' }, [
    h('div', { class: 'm-head' }, `${dayText(lesson.day)} ${parseTime(lesson.createdAt, 'HH:mm')} · ${classLabel(lesson.className)}`),
    renderWay(lesson),
    renderProblems(lesson),
    h('div', { class: 'm-meta' }, `${lesson.createdBy} · 做完 ${renderDone(lesson)}`),
    renderActions(lesson),
  ])
}

const desktopColumns: DataTableColumn<AdminLesson>[] = [
  { title: '日子', key: 'day', width: 130, render: (row) => dayText(row.day) },
  { title: '布置', key: 'createdAt', width: 70, render: (row) => parseTime(row.createdAt, 'HH:mm') },
  { title: '班级', key: 'className', width: 130, render: (row) => classLabel(row.className) },
  { title: '老师', key: 'createdBy', width: 90 },
  { title: '做什么', key: 'mode', width: 150, render: renderWay },
  { title: '题目', key: 'problems', width: 300, render: renderProblems },
  { title: '做完 / 全班', key: 'doneCount', width: 100, render: renderDone },
  { title: '', key: 'actions', render: renderActions },
]
const mobileColumns: DataTableColumn<AdminLesson>[] = [{ title: '课', key: 'id', render: renderMobileCard }]
const columns = computed(() => (isMobile.value ? mobileColumns : desktopColumns))
</script>

<template>
  <PageHeader title="课堂任务">
    <template #extra>
      <n-text v-if="data" depth="3">{{ data.total }} 节</n-text>
    </template>
    <template #actions>
      <n-button type="primary" @click="edit(null)">补一节</n-button>
    </template>
    <template #filters>
      <n-select v-model:value="query.className" :options="classOptions" filterable aria-label="班级" :style="{ width: isMobile ? '100%' : '160px' }" />
      <n-select v-model:value="query.teacher" :options="teacherOptions" aria-label="老师" :style="{ width: isMobile ? '100%' : '140px' }" />
      <n-select v-model:value="query.mode" :options="modeOptions" aria-label="做什么" :style="{ width: isMobile ? '100%' : '120px' }" />
    </template>
  </PageHeader>
  <n-data-table :loading="loading" striped class="lesson-table" :columns="columns" :data="data?.results ?? []" :row-key="(row: AdminLesson) => row.id" />
  <Pagination v-if="data" :total="data.total" v-model:limit="query.limit" v-model:page="query.page" />
  <LessonEditModal v-model:show="editing" :lesson="editingLesson" @saved="list" />
</template>

<style scoped>
.lesson-table :deep(.probs) {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.lesson-table :deep(.chip) {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  /* 描边不填底：斑马纹的隔行底色和 actionColor 是同一档灰，填底的话那几行看不出块 */
  border: 1px solid v-bind('theme.borderColor');
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  cursor: default;
}

.lesson-table :deep(.chip.hidden) {
  color: v-bind('theme.textColor3');
  text-decoration: line-through;
}

.lesson-table :deep(.way) {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.lesson-table :deep(.actions) {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.lesson-table :deep(.m-card) {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lesson-table :deep(.m-head) {
  font-weight: 500;
}

.lesson-table :deep(.m-meta) {
  font-size: 13px;
  color: v-bind('theme.textColor3');
}
</style>
