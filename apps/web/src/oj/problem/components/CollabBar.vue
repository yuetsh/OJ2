<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
import UserName from "shared/components/UserName.vue"

/**
 * 老师协作时右栏顶上的一条（设计稿「举手与协作」HcPageA）：正在帮谁、举手多久了、
 * 看他交过什么、帮完了、下一个。语言不写（用户说的）：编辑器工具栏的语言下拉就摆在下面。
 *
 * 用户选的方案 A 是「跳到题目页帮」，为了演示错误时题目和代码并排；代价是要离开看板，
 * 所以「帮完了」自动回到这个班的看板，还有人举手就给「下一个」直接去下一个人的题。
 *
 * 老师在看板上主动打开的（学生没举手，mode = peek）写「正在看 X 的代码」，按钮叫「看完了」。
 */
const collabStore = useCollabStore()
const { problem } = storeToRefs(useProblemStore())
const router = useRouter()

const room = computed(() => collabStore.room)
const peek = computed(() => room.value?.mode === "peek")

/** 他举手多久了：按 id 在举手列表里找他那条（已经是「在帮」了，列表里还留着） */
const request = computed(() =>
  collabStore.requests.find((item) => item.studentId === room.value?.peerId),
)
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, 1000) })
const waited = computed(() => {
  if (!request.value) return ""
  const seconds = Math.max(0, Math.floor((now.value.getTime() - request.value.createdAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
})

/** 下一个：还在排队的里面等得最久的（不会是眼前这个，他已经是「在帮」了） */
const next = computed(() => collabStore.nextRequest)

/**
 * 「看他交过什么」：只看这个学生、这道题。开新标签 —— 跳走这一页协作就断了。
 * exactUsername：整名匹配，不然学号相近的同学（ks24a1 / ks24a10…）会混进来
 */
function openHisSubmissions() {
  if (!room.value || !problem.value) return
  const target = router.resolve({
    name: "submissions",
    query: { problem: problem.value._id, username: room.value.peerName, exactUsername: "1" },
  })
  window.open(target.href, "_blank")
}

/**
 * 帮完了：结束这次（求助记录一并清掉），回到这个班的看板。
 * 等 room_closed 回来、room 清空了再跳 —— 房间还开着时离开题目页，题目页的拦截
 * （detail.vue 的 confirmLeavingHelp）会把跳转改成开新标签
 */
async function finish() {
  const className = room.value?.peerClassName
  collabStore.leave("done")
  await until(() => collabStore.room).toBe(null, { timeout: 3000 })
  router.push({ name: "classroom board", query: className ? { className } : {} })
}

/**
 * 帮完这个，接下一个：结束、再接单。新房间开好后 CollabHost 会跳到那道题
 * （同一道题就不跳，编辑器原地换成下一个人的代码）
 */
function finishAndNext() {
  const target = next.value
  if (!target) return
  collabStore.leave("done")
  collabStore.accept(target.studentId)
}
</script>

<template>
  <div v-if="room" class="collab-bar" role="status">
    <span class="dot" aria-hidden="true" />
    <span class="who">
      {{ peek ? "正在看" : "正在帮" }}
      <UserName :username="room.peerName" />
      <template v-if="peek"> 的代码</template>
    </span>
    <span v-if="!peek && waited" class="note">举手 {{ waited }}</span>
    <span class="spacer" />
    <button type="button" class="ghost" @click="openHisSubmissions">看他交过什么</button>
    <!-- 显式的「结束」：求助记录一并清掉。跳走页面发的是 leave("left")，
         那边只是退回排队 —— 见 store 里 leave 的注释 -->
    <button type="button" :class="next ? 'ghost' : 'end'" @click="finish">
      {{ peek ? "看完了" : "帮完了" }}
    </button>
    <button v-if="next" type="button" class="end" @click="finishAndNext">
      下一个：{{ next.studentName }} {{ next.problemId }} →
    </button>
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
  font-size: 14px;
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

/* UserName 按浅底配的色（前缀灰、名字近黑），深蓝底上要换 */
.who :deep(.prefix) {
  color: #b9cdee;
}

.who :deep(.name) {
  color: #fff;
}

.note {
  color: #b9cdee;
  font-variant-numeric: tabular-nums;
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
