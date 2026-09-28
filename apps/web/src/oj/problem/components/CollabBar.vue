<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
import { LANGUAGE_SHOW_VALUE } from "utils/constants"

/**
 * 老师协作时右栏顶上的一条：正在帮谁、他用什么语言、看他交过什么、结束协作。
 *
 * 原来这几样挤在工具栏里（一个标签 + 一个按钮），和老师自己的「提交」「课堂统计」混在一行，
 * 一眼看不出「现在编辑器里是学生的代码」。学生那边不加横幅，省下编辑器的 40px。
 */
const collabStore = useCollabStore()
const { problem } = storeToRefs(useProblemStore())
const router = useRouter()

/**
 * 「看他交过什么」：只看这个学生、这道题。开新标签 —— 跳走这一页协作就断了。
 * 原来工具栏的「本题提交」只带题号，老师得再手动筛一遍用户名
 */
function openHisSubmissions() {
  const room = collabStore.room
  if (!room || !problem.value) return
  const target = router.resolve({
    name: "submissions",
    query: { problem: problem.value._id, username: room.peerName },
  })
  window.open(target.href, "_blank")
}
</script>

<template>
  <div v-if="collabStore.room" class="collab-bar" role="status">
    <span class="who">
      正在帮 <b>{{ collabStore.room.peerName }}</b> ·
      {{ LANGUAGE_SHOW_VALUE[collabStore.room.language] }}
    </span>
    <n-button text class="link" @click="openHisSubmissions">看他交过什么 ↗</n-button>
    <!-- 显式的「结束」：求助记录一并清掉。跳走页面发的是 leave("left")，
         那边只是退回排队 —— 见 store 里 leave 的注释 -->
    <n-button size="small" class="end" @click="collabStore.leave('done')">结束协作</n-button>
  </div>
</template>

<style scoped>
.collab-bar {
  height: 40px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 12px;
  border-radius: 6px;
  background-color: #2080f0;
  color: #fff;
  font-size: 14px;
  white-space: nowrap;
}

.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.link {
  --n-text-color: #fff !important;
  --n-text-color-hover: rgba(255, 255, 255, 0.85) !important;
  --n-text-color-pressed: rgba(255, 255, 255, 0.7) !important;
  --n-text-color-focus: #fff !important;
  text-decoration: underline;
}

.end {
  margin-left: auto;
}
</style>
