<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { AdminLabelingListItem, LabelingKind } from '@oj2/contract'
import { NButton, NTag } from 'naive-ui'
import UserName from 'shared/components/UserName.vue'
import { errorMessage } from 'utils/api'
import { parseTime } from 'utils/functions'
import PageHeader from '../components/PageHeader.vue'
import { createAdminLabeling, deleteAdminLabeling, getAdminLabelings, reorderAdminLabelings } from '../api'

/**
 * 后台「数据标注」列表：一节一行，拖动排先后（学生列表照这个顺序）。
 * 新建问标题和类型（类型之后不能改），建好直接进出题页，排在最后。
 */
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const labelings = ref<AdminLabelingListItem[]>([])
const loading = ref(true)
const showCreate = ref(false)
const newTitle = ref('')
const creating = ref(false)
const newKind = ref<LabelingKind>('text')

const KIND_TEXT: Record<LabelingKind, string> = { text: '文字分类', image: '图片分类', span: '实体标注' }
const KIND_OPTIONS = (Object.keys(KIND_TEXT) as LabelingKind[]).map((value) => ({ value, label: KIND_TEXT[value] }))
const dragId = ref<number | null>(null)

/** 学生那边看到的第几节：只数公开的 */
const publicNo = computed(() => {
  const no = new Map<number, number>()
  labelings.value.filter((labeling) => labeling.isPublic).forEach((labeling, index) => no.set(labeling.id, index + 1))
  return no
})

async function drop(target: AdminLabelingListItem) {
  const fromId = dragId.value
  dragId.value = null
  if (fromId === null || fromId === target.id) return
  const fromIndex = labelings.value.findIndex((labeling) => labeling.id === fromId)
  const targetIndex = labelings.value.findIndex((labeling) => labeling.id === target.id)
  if (fromIndex < 0 || targetIndex < 0) return
  // 先在本地换好位置，拖完立刻看到
  const next = [...labelings.value]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moved!)
  labelings.value = next
  try {
    await reorderAdminLabelings(next.map((labeling) => labeling.id))
  } catch (err) {
    message.error(errorMessage(err))
    await load()
  }
}

function rowProps(row: AdminLabelingListItem) {
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
    labelings.value = await getAdminLabelings()
  } finally {
    loading.value = false
  }
}

async function create() {
  const title = newTitle.value.trim()
  if (!title) return
  creating.value = true
  try {
    const labeling = await createAdminLabeling(title, newKind.value)
    router.push({ name: 'admin labeling edit', params: { labelingID: labeling.id } })
  } catch (err) {
    message.error(errorMessage(err))
  } finally {
    creating.value = false
  }
}

function remove(labeling: AdminLabelingListItem) {
  dialog.warning({
    title: `删掉「${labeling.title}」？`,
    content: labeling.students ? `${labeling.students} 个学生做过，他们的作答会一起删掉。` : '这一节的数据会一起删掉。',
    positiveText: '删掉',
    negativeText: '算了',
    onPositiveClick: async () => {
      try {
        await deleteAdminLabeling(labeling.id)
        labelings.value = labelings.value.filter((item) => item.id !== labeling.id)
      } catch (err) {
        message.error(errorMessage(err))
      }
    },
  })
}

const columns: DataTableColumn<AdminLabelingListItem>[] = [
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
  { title: '类型', key: 'kind', width: 90, render: (row) => KIND_TEXT[row.kind] },
  { title: '条数', key: 'itemCount', width: 70 },
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
        h(NButton, { size: 'small', onClick: () => router.push({ name: 'admin labeling edit', params: { labelingID: row.id } }) }, () => '编辑'),
        h(NButton, { size: 'small', onClick: () => router.push({ name: 'labeling progress', params: { labelingID: row.id } }) }, () => '全班情况'),
        h(NButton, { size: 'small', type: 'error', ghost: true, onClick: () => remove(row) }, () => '删除'),
      ]),
  },
]

onMounted(load)
</script>

<template>
  <PageHeader title="数据标注">
    <template #actions>
      <n-button type="primary" @click="showCreate = true">新建一节</n-button>
    </template>
  </PageHeader>

  <n-data-table :columns="columns" :data="labelings" :loading="loading" :row-key="(row: AdminLabelingListItem) => row.id" :row-props="rowProps" />

  <n-modal v-model:show="showCreate" preset="card" title="新建一节" style="width: 440px" :bordered="false">
    <n-radio-group v-model:value="newKind" class="kinds">
      <n-radio-button v-for="o in KIND_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</n-radio-button>
    </n-radio-group>
    <n-input v-model:value="newTitle" placeholder="标题，比如：判断外卖评价是好评还是差评" maxlength="128" @keyup.enter="create" />
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <n-button @click="showCreate = false">算了</n-button>
        <n-button type="primary" :disabled="!newTitle.trim()" :loading="creating" @click="create">建好，开始出题</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.kinds {
  margin-bottom: 12px;
}
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
