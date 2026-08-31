<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useCollabStore } from "shared/store/collab"

/** 由顶栏的姓名下拉菜单打开 */
const show = defineModel<boolean>("show", { default: false })

const collabStore = useCollabStore()

// 接单之后要在弹框里替学生写代码，那个编辑器窄屏上没法用 —— 所以窄屏只让看
// 「谁在等」（角标、toast、这张列表照常给），接单留到桌面端
const { isDesktop } = useBreakpoints()

// 等待时长要每秒走一格，所以自己转一个 now。
// 只在弹框开着时转 —— 这个组件跟着顶栏常驻，关着的时候没人看这个数。
const now = ref(Date.now())
let timer: number | null = null

function stopTimer() {
  if (timer === null) return
  window.clearInterval(timer)
  timer = null
}

watch(show, (opened) => {
  if (!opened) {
    stopTimer()
    return
  }
  now.value = Date.now()
  if (timer === null) {
    timer = window.setInterval(() => (now.value = Date.now()), 1000)
  }
})

onUnmounted(stopTimer)

const waited = (createdAt: number) => {
  const seconds = Math.max(0, Math.floor((now.value - createdAt) / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

const handleAccept = (studentId: number, status: string) => {
  // 已被别的老师接走的不能点
  if (status === "active" || !isDesktop.value) return
  collabStore.accept(studentId)
  // 接单后马上要弹 CollabModal，这个列表得让位
  show.value = false
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    title="课堂求助"
    :style="{ width: '420px' }"
  >
    <div style="max-height: 60vh; overflow: auto">
      <n-alert
        v-if="!isDesktop"
        type="info"
        :bordered="false"
        style="margin-bottom: 8px"
      >
        接单要在电脑上打开
      </n-alert>

      <n-empty
        v-if="collabStore.groupedRequests.length === 0"
        description="暂无求助"
      />

      <div v-for="group in collabStore.groupedRequests" :key="group.problemId">
        <!-- 同题多人是个教学信号：该停下来全班讲，而不是挨个救 -->
        <n-flex align="center" justify="space-between" style="padding: 6px 4px">
          <n-text depth="3" style="font-size: 12px">
            {{ group.problemId }} · {{ group.problemTitle }}
          </n-text>
          <n-tag v-if="group.items.length > 1" size="small" type="warning">
            {{ group.items.length }} 人
          </n-tag>
        </n-flex>

        <n-flex
          v-for="item in group.items"
          :key="item.studentId"
          align="center"
          justify="space-between"
          :style="{
            padding: '6px 8px',
            borderRadius: '4px',
            opacity: item.status === 'active' ? 0.5 : 1,
            cursor:
              item.status === 'active' || !isDesktop ? 'default' : 'pointer',
          }"
          @click="handleAccept(item.studentId, item.status)"
        >
          <n-flex vertical :size="2">
            <n-text>
              {{ item.studentName }}
              <n-text depth="3" v-if="item.className"
                >（{{ item.className }}）</n-text
              >
            </n-text>
            <n-text depth="3" style="font-size: 12px">
              {{
                item.status === "active"
                  ? `${item.teacherName} 处理中`
                  : `等了 ${waited(item.createdAt)}`
              }}
            </n-text>
          </n-flex>

          <n-button
            v-if="item.status === 'pending'"
            quaternary
            circle
            size="small"
            @click.stop="collabStore.reject(item.studentId)"
          >
            <Icon icon="mdi:close" height="16" />
          </n-button>
        </n-flex>

        <n-divider style="margin: 4px 0" />
      </div>
    </div>
  </n-modal>
</template>
