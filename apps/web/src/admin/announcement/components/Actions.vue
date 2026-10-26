<script lang="ts" setup>
import { deleteAnnouncement } from 'admin/api'

/**
 * 公告一行的操作：编辑、置顶、删除直接摆出来（用户说的：不要收进 ⋯）
 */
interface Props {
  announcementID: number
  top: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ deleted: []; toggleTop: [] }>()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

function goEdit() {
  router.push({
    name: 'admin announcement edit',
    params: { announcementID: props.announcementID },
  })
}

function confirmDelete() {
  dialog.warning({
    title: '删除这条公告？',
    content: '删掉就找不回来了。只是不想让学生看到的话，关掉「学生看得到」就行。',
    positiveText: '删除',
    negativeText: '不删',
    onPositiveClick: async () => {
      await deleteAnnouncement(props.announcementID)
      message.success('删掉了')
      emit('deleted')
    },
  })
}
</script>
<template>
  <n-flex :size="6" :wrap="false">
    <n-button size="small" @click="goEdit">编辑</n-button>
    <n-button size="small" @click="emit('toggleTop')">
      {{ props.top ? '取消置顶' : '置顶' }}
    </n-button>
    <n-button size="small" quaternary type="error" @click="confirmDelete">删除</n-button>
  </n-flex>
</template>
