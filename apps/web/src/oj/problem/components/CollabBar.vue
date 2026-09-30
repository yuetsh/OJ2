<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"

/**
 * 老师协作时右栏顶上的一条：正在帮谁、看他交过什么、结束协作。语言不写（用户说的）：
 * 编辑器工具栏的语言下拉就摆在下面，这条短一点，长名字也放得下。
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
    // exactUsername：整名匹配，不然学号相近的同学（ks24a1 / ks24a10…）会混进来
    query: { problem: problem.value._id, username: room.peerName, exactUsername: "1" },
  })
  window.open(target.href, "_blank")
}
</script>

<template>
  <div v-if="collabStore.room" class="collab-bar" role="status">
    <span class="dot" aria-hidden="true" />
    <span class="who">正在帮 {{ collabStore.room.peerName }}</span>
    <span class="note">你改的他马上能看到</span>
    <span class="spacer" />
    <button type="button" class="ghost" @click="openHisSubmissions">看他交过什么</button>
    <!-- 显式的「结束」：求助记录一并清掉。跳走页面发的是 leave("left")，
         那边只是退回排队 —— 见 store 里 leave 的注释 -->
    <button type="button" class="end" @click="collabStore.leave('done')">结束协作</button>
  </div>
</template>

<style scoped>
/* 设计稿「上下文条与协作状态」：深蓝一条，顶在工具栏上面 */
.collab-bar {
  height: 40px;
  flex: none;
  box-sizing: border-box;
  padding: 0 10px 0 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  background-color: #1d4f9c;
  color: #fff;
  font-size: 13px;
  white-space: nowrap;
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #7fe0a8;
}

.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}

.note {
  color: #d5e2f6;
}

.spacer {
  flex: 1 1 0;
}

.ghost,
.end {
  flex: none;
  height: 28px;
  border-radius: 4px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.ghost {
  padding: 0 10px;
  border: 1px solid #8fb0e0;
  background: transparent;
  color: #fff;
}

.ghost:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.end {
  padding: 0 12px;
  border: 0;
  background-color: #fff;
  color: #1d4f9c;
  font-weight: 600;
}
</style>
