<script lang="ts" setup>
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

function openFront() {
  window.open(`/contest/${props.contest.id}`, "_blank")
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
  <!-- 操作直接摆出来，不收进 ⋯（用户说的） -->
  <n-flex :size="4" :wrap="false">
    <n-button size="small" @click="goEdit">编辑</n-button>
    <n-button size="small" @click="goClass">
      {{ contest.status === "-1" ? "成绩" : "全班情况" }}
    </n-button>
    <n-button size="small" @click="clone">复制一份</n-button>
    <n-button size="small" title="在前台打开这场比赛" @click="openFront">前台看</n-button>
  </n-flex>
</template>
<style scoped></style>
