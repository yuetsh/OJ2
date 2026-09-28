<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import { statisticsOpen } from "../composables/editorMenu"

/**
 * 教师的「课堂统计」弹窗。入口有两个（工具栏的按钮、「更多」菜单 / 手机「⋯」），
 * 弹窗只在题目页上挂一个。
 */
// 只有老师看得见，静态 import 的话每个学生打开题目都要白拉一份 chart.js（~68KB gzip）
const StatisticsPanel = defineAsyncComponent(() => import("shared/components/StatisticsPanel.vue"))

const userStore = useUserStore()
const { problem } = storeToRefs(useProblemStore())
const { isDesktop } = useBreakpoints()
</script>

<template>
  <n-modal
    v-if="userStore.isTeacherOrAbove && problem"
    v-model:show="statisticsOpen"
    preset="card"
    title="提交记录的统计"
    :style="{ maxWidth: isDesktop && '800px', maxHeight: '80vh' }"
    :content-style="{ overflow: 'auto' }"
  >
    <StatisticsPanel :problem="problem._id" username="" />
  </n-modal>
</template>
