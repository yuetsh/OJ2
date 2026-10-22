<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { errorKind } from "utils/errorKind"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useTeacherHelp } from "shared/composables/teacherHelp"
import { useCollabStore } from "shared/store/collab"
import type { CollabRequestItem } from "shared/composables/websocket"
import { SubmissionStatus } from "utils/constants"
import UserName from "./UserName.vue"

/**
 * 顶栏「N 人举手」点开的面板（设计稿「举手与协作」HcPanel），挂在按钮下面，不是弹框。
 *
 * 按题分组，每人写错法（和课堂看板同一套 errorKind）和等了多久。同一道题两人以上举手，
 * 用户的做法是**停下来全班讲**：组头给「讲这道题」（去看板、选中这道题看错法）和
 * 「讲完了，都放下」（这道题还在排队的手一次放下）。
 */
const emit = defineEmits<{ close: [] }>()

const collabStore = useCollabStore()
const router = useRouter()
const { help } = useTeacherHelp()
// 接单之后要在题目页的编辑器里替学生写代码，那个编辑器窄屏上没法用 —— 窄屏只让看
const { isDesktop } = useBreakpoints()

// 等待时长每秒走一格。面板只在打开时挂着，关着不转
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, 1000) })
function waited(createdAt: number) {
  const seconds = Math.max(0, Math.floor((now.value.getTime() - createdAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
/** 等了三分钟以上标红 */
function waitedLong(createdAt: number) {
  return now.value.getTime() - createdAt >= 180_000
}

function kindOf(item: CollabRequestItem) {
  if (!item.latest) return "还没交过"
  if (item.latest.result === SubmissionStatus.accepted) return "已经做对了"
  return errorKind(item.latest).label
}

function pendingOf(items: CollabRequestItem[]) {
  return items.filter((item) => item.status === "pending")
}

function onHelp(item: CollabRequestItem) {
  if (help(item.studentId)) emit("close")
}

/** 「讲这道题」：去这个班的看板、选中这道题，下面展开错着的人按错法归堆，点人就是讲错误弹层 */
function explain(items: CollabRequestItem[], problemId: string) {
  const className = items.find((item) => item.className)?.className
  emit("close")
  router.push({
    name: "classroom board",
    query: { ...(className ? { className } : {}), problem: problemId },
  })
}
</script>

<template>
  <div class="panel">
    <div class="title">
      <b>举手 {{ collabStore.requests.length }} 人</b>
    </div>
    <n-alert v-if="!isDesktop" type="info" :bordered="false">接单要在电脑上打开</n-alert>
    <n-empty v-if="collabStore.groupedRequests.length === 0" description="没有人举手" />
    <div
      v-for="group in collabStore.groupedRequests"
      :key="group.problemId"
      class="group"
      :class="{ many: pendingOf(group.items).length >= 2 }"
    >
      <div class="group-head">
        <span class="group-title">
          <b class="num">{{ group.problemId }}</b>
          <span class="muted">{{ group.problemTitle }}</span>
        </span>
        <b class="group-count">{{ group.items.length }} 人</b>
        <template v-if="pendingOf(group.items).length >= 2">
          <n-button size="small" @click="explain(group.items, group.problemId)">讲这道题</n-button>
          <n-button size="small" @click="collabStore.dismiss(group.problemId)">
            讲完了，都放下
          </n-button>
        </template>
      </div>
      <div v-for="item in group.items" :key="item.studentId" class="row">
        <div class="who">
          <UserName :username="item.studentName" />
          <span class="kind">{{ kindOf(item) }}</span>
        </div>
        <template v-if="item.status === 'active'">
          <n-text type="info" strong class="helping">{{ item.teacherName }} 在帮</n-text>
        </template>
        <template v-else>
          <span class="waited" :class="{ long: waitedLong(item.createdAt) }">
            等了 {{ waited(item.createdAt) }}
          </span>
          <n-button v-if="isDesktop" type="primary" size="small" @click="onHelp(item)">
            去帮
          </n-button>
          <n-button
            quaternary
            circle
            size="small"
            aria-label="放下举手"
            title="放下举手"
            @click="collabStore.reject(item.studentId)"
          >
            <Icon icon="mdi:close" height="16" />
          </n-button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  width: 440px;
  max-width: calc(100vw - 32px);
  max-height: 70vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.title {
  font-size: 15px;
}

.group {
  border: 1px solid var(--n-divider-color, #e6e7eb);
  border-radius: 8px;
  overflow: hidden;
}

.group.many {
  border-color: #f3d6dd;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(128, 128, 128, 0.08);
  white-space: nowrap;
}

.group.many .group-head {
  background: rgba(208, 48, 80, 0.07);
}

.group-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
}

.group-title .muted {
  margin-left: 6px;
}

.group-count {
  font-size: 14px;
}

.group.many .group-count {
  color: #c0304e;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 8px 0 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
}

.who {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  font-size: 15px;
}

.kind {
  font-size: 12px;
  line-height: 16px;
  opacity: 0.65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.waited {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
  white-space: nowrap;
}

.waited.long {
  color: #c0304e;
  opacity: 1;
}

.helping {
  font-size: 13px;
  white-space: nowrap;
}

.muted {
  opacity: 0.6;
}

.num {
  font-variant-numeric: tabular-nums;
}
</style>
