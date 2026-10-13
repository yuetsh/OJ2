<script lang="ts" setup>
import PageHeader from "admin/components/PageHeader.vue"
import { errorMessage } from "utils/api"
import TextEditor from "shared/components/TextEditor.vue"
import type { AnnouncementEdit } from "utils/types"
import { createAnnouncement, editAnnouncement, getAnnouncement } from "../api"

interface Props {
  announcementID?: string
}

const route = useRoute()
const router = useRouter()
const message = useMessage()
const props = defineProps<Props>()
const [ready, toggleReady] = useToggle()

const announcement = reactive<AnnouncementEdit>({
  id: 0,
  title: "",
  tag: "公告",
  content: "",
  visible: false,
  top: false,
})

const tags: SelectOption[] = [
  { label: "公告", value: "公告" },
  { label: "更新", value: "更新" },
]

async function init() {
  if (!props.announcementID) {
    toggleReady(true)
    return
  }
  const id = parseInt(route.params.announcementID as string)
  const res = await getAnnouncement(id)
  toggleReady(true)
  announcement.id = id
  announcement.title = res.title
  announcement.content = res.content
  announcement.visible = res.visible
  announcement.tag = res.tag
  announcement.top = res.top
}

async function submit() {
  if (announcement.content === "<p><br></p>") {
    announcement.content = ""
  }
  if (!announcement.title || !announcement.content) {
    message.error("标题和正文必填")
    return
  }
  const api = {
    "admin announcement create": createAnnouncement,
    "admin announcement edit": editAnnouncement,
  }[route.name as string]
  try {
    await api!(announcement)
    if (route.name === "admin announcement create") {
      message.success("发好了")
    } else {
      message.success("改好了")
    }
    router.push({ name: "admin announcement list" })
  } catch (err) {
    message.error(errorMessage(err))
  }
}

onMounted(init)
</script>
<template>
  <PageHeader
    :title="route.name === 'admin announcement create' ? '写一条公告' : '改公告'"
    :back="{ name: 'admin announcement list' }"
  >
    <template #actions>
      <n-button type="primary" @click="submit">保存</n-button>
    </template>
  </PageHeader>
  <!-- 标题、类型、置顶、学生看得到排一行；保存在右上角，不用滚到正文底下去点 -->
  <div class="meta">
    <n-input
      v-model:value="announcement.title"
      placeholder="标题"
      size="large"
      class="title"
      aria-label="标题"
    />
    <n-radio-group v-model:value="announcement.tag" aria-label="类型">
      <n-radio-button v-for="t in tags" :key="String(t.value)" :value="t.value">
        {{ t.label }}
      </n-radio-button>
    </n-radio-group>
    <label class="switch">置顶 <n-switch v-model:value="announcement.top" /></label>
    <label class="switch">学生看得到 <n-switch v-model:value="announcement.visible" /></label>
  </div>
  <TextEditor v-if="ready" title="正文" v-model:value="announcement.content" :min-height="320" />
</template>
<style scoped>
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 16px;
}

.title {
  flex: 1 1 320px;
  max-width: 560px;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  cursor: pointer;
}
</style>
