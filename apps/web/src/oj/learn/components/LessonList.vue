<script setup lang="ts">
import { TUTORIAL_READ_SECONDS } from "@oj2/contract"
import type { TutorialProgress } from "utils/types"
import { readableDuration } from "utils/functions"

defineProps<{
  titles: { id: number; title: string }[]
  step: number
  /** 按教程 id 索引的自学留痕，未登录时是空的 */
  progress: Record<number, TutorialProgress>
  /** 是否在留痕（登录了才留） */
  traced: boolean
}>()

const emit = defineEmits<{ select: [lesson: number] }>()

// 打开过但一秒都没攒够时 readableDuration 给的是 "-"，「读了 -」不像人话。
// 心跳 15 秒一跳，点开就走确实会落在 0 上
function readSoFar(seconds: number) {
  return seconds > 0 ? readableDuration(seconds) : "不到 1 分钟"
}
</script>

<template>
  <n-list hoverable clickable>
    <n-list-item
      v-for="(item, index) in titles"
      :key="item.id"
      @click="emit('select', index + 1)"
    >
      <!-- 标题独占一行：目录栏只有屏幕的五分之一宽，把「已读」摆在同一行会把
           中文标题挤成两截 -->
      <n-flex vertical :size="2">
        <n-text
          :type="step === index + 1 ? 'primary' : undefined"
          :strong="step === index + 1"
        >
          {{ index + 1 }}. {{ item.title }}
        </n-text>
        <!-- 每篇教程都有一条进度（没读过的是一行零），所以这里判的是读没读过，
             不是有没有这条记录。
             满 TUTORIAL_READ_SECONDS 才打 ✓：打开过但没读满的仍然显示时长，
             只是不带勾、也不是成功色 —— 记是记下了，还没到「已读」 -->
        <n-text
          v-if="progress[item.id]?.totalSeconds >= TUTORIAL_READ_SECONDS"
          type="success"
          style="font-size: 12px"
        >
          ✓ 已读 · {{ readableDuration(progress[item.id].totalSeconds) }}
        </n-text>
        <n-text
          v-else-if="progress[item.id]?.viewCount"
          depth="3"
          style="font-size: 12px"
        >
          读了 {{ readSoFar(progress[item.id].totalSeconds) }}
        </n-text>
        <n-text
          v-if="progress[item.id]?.exerciseTotal"
          :type="
            progress[item.id].exerciseSolved === progress[item.id].exerciseTotal
              ? 'success'
              : undefined
          "
          :depth="
            progress[item.id].exerciseSolved === progress[item.id].exerciseTotal
              ? undefined
              : 3
          "
          style="font-size: 12px"
        >
          练一练 {{ progress[item.id].exerciseSolved }} /
          {{ progress[item.id].exerciseTotal }}
        </n-text>
      </n-flex>
    </n-list-item>
  </n-list>

  <!-- 只在没登录时提一句。登录了却还没读的人不需要被提醒「你还没读」 -->
  <n-text v-if="!traced" depth="3" style="display: block; padding: 8px 4px">
    登录后可以记录学习进度
  </n-text>
</template>
