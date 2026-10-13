<script lang="ts" setup>
import { Icon } from "@iconify/vue"
import type { AdminContest } from "utils/types"
import { cloneContest } from "../../api"

interface Props {
  contest: AdminContest
}
const props = defineProps<Props>()
const router = useRouter()
const message = useMessage()

function goEdit() {
  router.push({
    name: "admin contest edit",
    params: { contestID: props.contest.id },
  })
}

// 原来的「审核」页并进了前台比赛页老师的「全班情况 / 成绩」：点格子看代码、标看过了
function goClass() {
  window.open(`/contest/${props.contest.id}/class`, "_blank")
}

const menuOptions: DropdownOption[] = [
  { label: "复制一份", key: "clone" },
  { label: "在前台看", key: "view" },
]

function onMenu(key: string) {
  if (key === "clone") clone()
  else if (key === "view") window.open(`/contest/${props.contest.id}`, "_blank")
}

async function clone() {
  try {
    const res = await cloneContest(props.contest.id)
    message.success("复制成功")
    router.push({
      name: "admin contest edit",
      params: { contestID: res.id },
    })
  } catch {
    message.error("复制失败")
  }
}
</script>
<template>
  <n-flex :size="4" justify="end" :wrap="false">
    <n-button size="small" @click="goEdit">编辑</n-button>
    <n-button size="small" @click="goClass">
      {{ contest.status === "-1" ? "成绩" : "全班情况" }}
    </n-button>
    <n-dropdown trigger="click" placement="bottom-end" :options="menuOptions" @select="onMenu">
      <n-button size="small" quaternary aria-label="更多">
        <template #icon><Icon icon="ph:dots-three-bold" /></template>
      </n-button>
    </n-dropdown>
  </n-flex>
</template>
<style scoped></style>
