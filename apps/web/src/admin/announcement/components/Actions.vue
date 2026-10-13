<script lang="ts" setup>
import { Icon } from "@iconify/vue"
import { deleteAnnouncement } from "admin/api"

/**
 * 公告一行的操作（设计稿「后台公告」AnnAdmin）：「编辑」常驻，置顶 / 删除收进 ⋯
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
    name: "admin announcement edit",
    params: { announcementID: props.announcementID },
  })
}

const menuOptions = computed<DropdownOption[]>(() => [
  { label: props.top ? "取消置顶" : "置顶", key: "top" },
  { type: "divider", key: "divider" },
  { label: "删除", key: "delete" },
])

function onMenu(key: string) {
  if (key === "top") emit("toggleTop")
  else if (key === "delete") {
    dialog.warning({
      title: "删除这条公告？",
      content: "删掉就找不回来了。只是不想让学生看到的话，关掉「学生看得到」就行。",
      positiveText: "删除",
      negativeText: "不删",
      onPositiveClick: async () => {
        await deleteAnnouncement(props.announcementID)
        message.success("删掉了")
        emit("deleted")
      },
    })
  }
}
</script>
<template>
  <n-flex :size="4" justify="end" :wrap="false">
    <n-button size="small" @click="goEdit">编辑</n-button>
    <n-dropdown trigger="click" placement="bottom-end" :options="menuOptions" @select="onMenu">
      <n-button size="small" quaternary aria-label="更多">
        <template #icon><Icon icon="ph:dots-three-bold" /></template>
      </n-button>
    </n-dropdown>
  </n-flex>
</template>
