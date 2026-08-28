<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useCollabStore } from "shared/store/collab"

const collabStore = useCollabStore()

// 等待时长要每秒走一格，所以自己转一个 now
const now = ref(Date.now())
let timer: number | null = null
onMounted(() => {
  timer = window.setInterval(() => (now.value = Date.now()), 1000)
})
onUnmounted(() => {
  if (timer !== null) window.clearInterval(timer)
})

const waited = (createdAt: number) => {
  const seconds = Math.max(0, Math.floor((now.value - createdAt) / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

const handleAccept = (studentId: number, status: string) => {
  // 已被别的老师接走的不能点
  if (status === "active") return
  collabStore.accept(studentId)
}
</script>

<template>
  <n-popover trigger="click" placement="bottom-end" style="padding: 0">
    <template #trigger>
      <n-badge :value="collabStore.pendingCount" :max="99">
        <n-button>
          <Icon icon="fluent-emoji:raising-hand" height="20" />
          <span style="padding-left: 8px">求助</span>
        </n-button>
      </n-badge>
    </template>

    <div style="width: 320px; max-height: 60vh; overflow: auto; padding: 8px">
      <n-empty v-if="collabStore.groupedRequests.length === 0" description="暂无求助" />

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
            cursor: item.status === 'active' ? 'default' : 'pointer',
          }"
          @click="handleAccept(item.studentId, item.status)"
        >
          <n-flex vertical :size="2">
            <n-text>
              {{ item.studentName }}
              <n-text depth="3" v-if="item.className">（{{ item.className }}）</n-text>
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
  </n-popover>
</template>
