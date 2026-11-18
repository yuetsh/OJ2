<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { AdminModelTrainingListItem } from '@oj2/contract'
import { NButton, NTag } from 'naive-ui'
import UserName from 'shared/components/UserName.vue'
import { errorMessage } from 'utils/api'
import { parseTime } from 'utils/functions'
import PageHeader from '../components/PageHeader.vue'
import { createAdminModelTraining, deleteAdminModelTraining, getAdminModelTrainings, reorderAdminModelTrainings } from '../api'

/**
 * 后台「训练模型」列表：一节一行，拖动排先后（学生列表照这个顺序）。
 * 新建只问标题，建好直接进出题页，排在最后。
 */
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const lessons = ref<AdminModelTrainingListItem[]>([])
const loading = ref(true)
const showCreate = ref(false)
const newTitle = ref('')
const creating = ref(false)
const dragId = ref<number | null>(null)

/** 学生那边看到的第几节：只数公开的 */
const publicNo = computed(() => {
  const no = new Map<number, number>()
  lessons.value.filter((l) => l.isPublic).forEach((l, index) => no.set(l.id, index + 1))
  return no
})

async function drop(target: AdminModelTrainingListItem) {
  const fromId = dragId.value
  dragId.value = null
  if (fromId === null || fromId === target.id) return
  const fromIndex = lessons.value.findIndex((l) => l.id === fromId)
  const targetIndex = lessons.value.findIndex((l) => l.id === target.id)
  if (fromIndex < 0 || targetIndex < 0) return
  const next = [...lessons.value]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moved!)
  lessons.value = next
  try {
    await reorderAdminModelTrainings(next.map((l) => l.id))
  } catch (err) {
    message.error(errorMessage(err))
    await load()
  }
}

function rowProps(row: AdminModelTrainingListItem) {
  return {
    draggable: true,
    class: dragId.value === row.id ? 'dragging' : undefined,
    onDragstart: () => (dragId.value = row.id),
    onDragend: () => (dragId.value = null),
    onDragover: (e: DragEvent) => e.preventDefault(),
    onDrop: () => drop(row),
  }
}

async function load() {
  loading.value = true
  try {
    lessons.value = await getAdminModelTrainings()
  } finally {
    loading.value = false
  }
}

async function create() {
  const title = newTitle.value.trim()
  if (!title) return
  creating.value = true
  try {
    const lesson = await createAdminModelTraining(title)
    router.push({ name: 'admin model training edit', params: { modelTrainingID: lesson.id } })
  } catch (err) {
    message.error(errorMessage(err))
  } finally {
    creating.value = false
  }
}

function remove(lesson: AdminModelTrainingListItem) {
  dialog.warning({
    title: `删掉「${lesson.title}」？`,
    content: lesson.students ? `${lesson.students} 个学生训练过，他们的改动和记录会一起删掉。` : '这一节的数据会一起删掉。',
    positiveText: '删掉',
    negativeText: '算了',
    onPositiveClick: async () => {
      try {
        await deleteAdminModelTraining(lesson.id)
        lessons.value = lessons.value.filter((l) => l.id !== lesson.id)
      } catch (err) {
        message.error(errorMessage(err))
      }
    },
  })
}

const columns: DataTableColumn<AdminModelTrainingListItem>[] = [
  {
    title: '',
    key: 'drag',
    width: 36,
    render: () => h('span', { class: 'handle', 'aria-hidden': 'true' }, h(Icon, { icon: 'ph:dots-six-vertical-bold', width: 16 })),
  },
  {
    title: '#',
    key: 'no',
    width: 44,
    render: (row) => h('span', { class: 'no' }, publicNo.value.get(row.id) ?? '—'),
  },
  {
    title: '标题',
    key: 'title',
    minWidth: 240,
    render: (row) => h('span', { style: 'font-weight: 600' }, row.title),
  },
  {
    title: '训练 / 练习 / 考试',
    key: 'counts',
    width: 150,
    render: (row) => h('span', { style: 'font-variant-numeric: tabular-nums' }, `${row.trainCount} / ${row.practiceCount} / ${row.finalCount}`),
  },
  { title: '训练过的学生', key: 'students', width: 110 },
  {
    title: '学生看得到',
    key: 'isPublic',
    width: 100,
    render: (row) => h(NTag, { size: 'small', bordered: false, type: row.isPublic ? 'success' : 'default' }, () => (row.isPublic ? '看得到' : '没公开')),
  },
  { title: '出题人', key: 'createdBy', width: 120, render: (row) => h(UserName, { username: row.createdBy.username }) },
  { title: '改过', key: 'updatedAt', width: 150, render: (row) => h('span', { style: 'white-space: nowrap' }, parseTime(row.updatedAt, 'M月D日 HH:mm')) },
  {
    title: '',
    key: 'actions',
    width: 230,
    render: (row) =>
      h('div', { style: 'display: flex; gap: 8px' }, [
        h(NButton, { size: 'small', onClick: () => router.push({ name: 'admin model training edit', params: { modelTrainingID: row.id } }) }, () => '编辑'),
        h(NButton, { size: 'small', onClick: () => router.push({ name: 'model training progress', params: { modelTrainingID: row.id } }) }, () => '全班情况'),
        h(NButton, { size: 'small', type: 'error', ghost: true, onClick: () => remove(row) }, () => '删除'),
      ]),
  },
]

onMounted(load)
</script>

<template>
  <PageHeader title="训练模型">
    <template #actions>
      <n-button type="primary" @click="showCreate = true">新建一节</n-button>
    </template>
  </PageHeader>

  <n-data-table :columns="columns" :data="lessons" :loading="loading" :row-key="(row: AdminModelTrainingListItem) => row.id" :row-props="rowProps" />

  <n-modal v-model:show="showCreate" preset="card" title="新建一节" style="width: 440px" :bordered="false">
    <n-input v-model:value="newTitle" placeholder="标题，比如：外卖评论：好评还是差评" maxlength="128" @keyup.enter="create" />
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <n-button @click="showCreate = false">算了</n-button>
        <n-button type="primary" :disabled="!newTitle.trim()" :loading="creating" @click="create">建好，开始出题</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
:deep(.handle) {
  display: flex;
  opacity: 0.4;
  cursor: grab;
}
:deep(.no) {
  opacity: 0.6;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
:deep(tr.dragging) {
  opacity: 0.35;
}
</style>
