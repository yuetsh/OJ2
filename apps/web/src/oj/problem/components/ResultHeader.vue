<script setup lang="ts">
import { useThemeVars } from "naive-ui"

/**
 * 结果页签里每一块结果的标题：圆形状态图标 + 大字 + 灰色小字，下面可以挂一条测试点进度。
 * 设计稿「答案错误」「答案正确」「运行例子」「语法没过」几张画板都是这一个样子：
 * 不套整块的彩色提示框，颜色只落在图标和大字上。
 */
const props = defineProps<{
  kind: "success" | "error" | "warning" | "info" | "pending"
  title: string
  sub?: string
  /** 测试点进度：通过几个、一共几个 */
  progress?: { passed: number; total: number } | null
}>()

const theme = useThemeVars()

const color = computed(() => {
  switch (props.kind) {
    case "success":
      return { icon: theme.value.successColor, text: theme.value.successColorPressed }
    case "error":
      return { icon: theme.value.errorColor, text: theme.value.errorColorPressed }
    case "warning":
      return { icon: theme.value.warningColor, text: theme.value.warningColorPressed }
    default:
      return { icon: theme.value.infoColor, text: theme.value.textColor1 }
  }
})
</script>

<template>
  <div class="result-header">
    <div class="line">
      <span class="badge" :class="kind" aria-hidden="true">
        <svg
          v-if="kind === 'success'"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 12l5 5 9-10" />
        </svg>
        <svg
          v-else-if="kind === 'error'"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3.5"
          stroke-linecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
        <svg
          v-else-if="kind === 'pending'"
          class="spin"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
        >
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
        <svg
          v-else
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3.5"
          stroke-linecap="round"
        >
          <path d="M12 6v7" />
          <path d="M12 18h.01" />
        </svg>
      </span>
      <span class="title">{{ title }}</span>
      <span v-if="sub" class="sub">{{ sub }}</span>
      <slot name="extra" />
    </div>
    <div
      v-if="progress && progress.total > 0"
      class="progress"
      role="img"
      :aria-label="`通过 ${progress.passed}/${progress.total} 个测试点`"
    >
      <div
        class="progress-fill"
        :style="{ width: `${(progress.passed / progress.total) * 100}%` }"
      />
    </div>
  </div>
</template>

<style scoped>
.result-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.badge {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background-color: v-bind("color.icon");
}

.title {
  font-size: 18px;
  font-weight: 700;
  color: v-bind("color.text");
}

.sub {
  color: v-bind("theme.textColor3");
}

.progress {
  height: 6px;
  border-radius: 3px;
  background-color: rgba(208, 48, 80, 0.18);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  background-color: v-bind("theme.successColor");
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
