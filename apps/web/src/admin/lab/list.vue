<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { AdminLabListItem } from '@oj2/contract'
import { NButton, NTag } from 'naive-ui'
import UserName from 'shared/components/UserName.vue'
import { errorMessage } from 'utils/api'
import { parseTime } from 'utils/functions'
import PageHeader from '../components/PageHeader.vue'
import { createAdminLab, deleteAdminLab, getAdminLabs, reorderAdminLabs } from '../api'

/**
 * 后台「数据分析」列表：一节一行，拖动排先后（学生列表照这个顺序）。
 * 新建只问标题，建好直接进出题页（素材要挂在已有的一节下面），排在最后。
 */
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const labs = ref<AdminLabListItem[]>([])
const loading = ref(true)
const showCreate = ref(false)
const newTitle = ref('')
const creating = ref(false)
const dragId = ref<number | null>(null)

/** 学生那边看到的第几节：只数公开的 */
const publicNo = computed(() => {
  const no = new Map<number, number>()
  labs.value.filter((lab) => lab.isPublic).forEach((lab, index) => no.set(lab.id, index + 1))
  return no
})

async function drop(target: AdminLabListItem) {
  const fromId = dragId.value
  dragId.value = null
  if (fromId === null || fromId === target.id) return
  const fromIndex = labs.value.findIndex((lab) => lab.id === fromId)
  const targetIndex = labs.value.findIndex((lab) => lab.id === target.id)
  if (fromIndex < 0 || targetIndex < 0) return
  // 先在本地换好位置，拖完立刻看到
  const next = [...labs.value]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moved!)
  labs.value = next
  try {
    await reorderAdminLabs(next.map((lab) => lab.id))
  } catch (err) {
    message.error(errorMessage(err))
    await load()
  }
}

function rowProps(row: AdminLabListItem) {
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
    labs.value = await getAdminLabs()
  } finally {
    loading.value = false
  }
}

async function create() {
  const title = newTitle.value.trim()
  if (!title) return
  creating.value = true
  try {
    const lab = await createAdminLab(title)
    router.push({ name: 'admin lab edit', params: { labID: lab.id } })
  } catch (err) {
    message.error(errorMessage(err))
  } finally {
    creating.value = false
  }
}

function remove(lab: AdminLabListItem) {
  dialog.warning({
    title: `删掉「${lab.title}」？`,
    content: lab.students ? `${lab.students} 个学生做过，他们的代码和进度会一起删掉。` : '步骤和素材会一起删掉。',
    positiveText: '删掉',
    negativeText: '算了',
    onPositiveClick: async () => {
      try {
        await deleteAdminLab(lab.id)
        labs.value = labs.value.filter((item) => item.id !== lab.id)
      } catch (err) {
        message.error(errorMessage(err))
      }
    },
  })
}

const columns: DataTableColumn<AdminLabListItem>[] = [
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
  { title: '步数', key: 'stepCount', width: 70 },
  { title: '做过的学生', key: 'students', width: 100 },
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
        h(NButton, { size: 'small', onClick: () => router.push({ name: 'admin lab edit', params: { labID: row.id } }) }, () => '编辑'),
        h(NButton, { size: 'small', onClick: () => router.push({ name: 'lab progress', params: { labID: row.id } }) }, () => '全班进度'),
        h(NButton, { size: 'small', type: 'error', ghost: true, onClick: () => remove(row) }, () => '删除'),
      ]),
  },
]

onMounted(load)
</script>

<template>
  <PageHeader title="数据分析">
    <template #actions>
      <n-button type="primary" @click="showCreate = true">新建一节</n-button>
    </template>
  </PageHeader>

  <n-data-table :columns="columns" :data="labs" :loading="loading" :row-key="(row: AdminLabListItem) => row.id" :row-props="rowProps" />

  <n-modal v-model:show="showCreate" preset="card" title="新建一节" style="width: 440px" :bordered="false">
    <n-input v-model:value="newTitle" placeholder="标题，比如：用 pandas 分析班级成绩" maxlength="128" @keyup.enter="create" />
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
