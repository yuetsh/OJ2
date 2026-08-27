<template>
  <n-grid v-if="submission" :cols="5" :x-gap="16">
    <!-- 左侧：流程图预览区域 -->
    <n-gi :span="3">
      <n-card title="流程图预览">
        <template #header-extra>
          <n-button
            v-if="!renderError && submission?.mermaidCode"
            quaternary
            size="small"
            @click="showLargeImage = true"
          >
            <template #icon>
              <Icon icon="ph:corners-out" />
            </template>
            查看大图
          </n-button>
        </template>
        <div class="flowchart">
          <n-alert v-if="renderError" type="error" title="流程图渲染失败">
            {{ renderError }}
          </n-alert>
          <Teleport to="body" :disabled="!showLargeImage">
            <div
              v-show="!renderError"
              :class="['flowchart', { 'flowchart-fullscreen': showLargeImage }]"
              ref="mermaidContainer"
            ></div>
            <div v-if="showLargeImage" class="fullscreen-toolbar">
              <n-button secondary round @click="showLargeImage = false">
                <template #icon>
                  <Icon icon="ph:corners-in" />
                </template>
                退出大图
              </n-button>
            </div>
          </Teleport>
        </div>
      </n-card>
    </n-gi>

    <!-- 右侧：评分详情区域 -->
    <n-gi :span="2">
      <!-- AI反馈 -->
      <n-card
        v-if="submission.aiFeedback"
        size="small"
        title="AI反馈"
        style="margin-bottom: 16px"
      >
        <n-text>{{ submission.aiFeedback }}</n-text>
      </n-card>

      <!-- 改进建议 -->
      <n-card
        v-if="suggestionLines.length"
        size="small"
        title="改进建议"
        style="margin-bottom: 16px"
      >
        <n-flex vertical :size="6">
          <n-text
            v-for="(suggestion, index) in suggestionLines"
            :key="`${index}-${suggestion}`"
          >
            {{ suggestion }}
          </n-text>
        </n-flex>
      </n-card>

      <!-- 详细评分 -->
      <n-card
        v-if="sortedCriteria.length > 0"
        size="small"
        title="详细评分"
      >
        <div
          v-for="[key, detail] in sortedCriteria"
          :key="key"
          style="margin-bottom: 12px"
        >
          <!-- 评分项标题和分数 -->
          <n-flex
            justify="space-between"
            align="center"
            style="margin-bottom: 4px"
          >
            <n-text strong>{{ key }}</n-text>
            <n-tag
              :type="getPercentType(detail.score / detail.max)"
              size="small"
              round
            >
              {{ detail.score || 0 }}分 / {{ detail.max }}分
            </n-tag>
          </n-flex>
          <!-- 评分项详细说明 -->
          <n-text v-if="detail.comment" depth="3" style="font-size: 12px">
            {{ detail.comment }}
          </n-text>
        </div>
      </n-card>
    </n-gi>
  </n-grid>
  <n-spin v-else :show="loading" class="loading-container"> </n-spin>
</template>

<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { FlowchartSubmission } from "utils/types"
import { useMermaid } from "shared/composables/useMermaid"
import { sortFlowchartCriteria } from "utils/constants"

interface Props {
  submissionId: string
}

const props = defineProps<Props>()
const mermaidContainer = useTemplateRef<HTMLElement>("mermaidContainer")
const { renderError, renderFlowchart } = useMermaid()

const submission = ref<FlowchartSubmission | null>(null)

/**
 * 评分项明细。契约里是 `Record<string, unknown>` —— 内容是 AI 模型原样吐出的 JSON，
 * 后端不校验形状，所以这里只能按约定断言，字段缺失时用 0 / 空串兜底。
 */
const criteriaDetails = computed<
  Record<string, { score: number; max: number; comment: string }>
>(() => {
  const raw = submission.value?.aiCriteriaDetails ?? {}
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      const item = (value ?? {}) as Partial<{
        score: number
        max: number
        comment: string
      }>
      return [
        key,
        {
          score: item.score ?? 0,
          max: item.max ?? 0,
          comment: item.comment ?? "",
        },
      ]
    }),
  )
})
// jsonb 不保留键序，直接遍历会把 40 分的「逻辑正确性」排到最后
const sortedCriteria = computed(() => sortFlowchartCriteria(criteriaDetails.value))

const loading = ref(false)
const rendering = ref(false)
const showLargeImage = ref(false)
const suggestionLines = computed(() =>
  splitSuggestionLines(submission.value?.aiSuggestions),
)

function splitSuggestionLines(suggestions?: string | null) {
  return suggestions
    ? suggestions
        .split("\n")
        .map((suggestion) => suggestion.trim())
        .filter(Boolean)
    : []
}

function getPercentType(percent: number) {
  if (percent >= 0.8) return "primary"
  else if (percent >= 0.6) return "info"
  else if (percent >= 0.4) return "warning"
  return "error"
}

async function loadSubmission() {
  if (!props.submissionId) return
  showLargeImage.value = false
  loading.value = true
  try {
    const { getFlowchartSubmission } = await import("oj/api")
    const res = await getFlowchartSubmission(props.submissionId)
    submission.value = res

    // 渲染流程图
    if (submission.value?.mermaidCode) {
      rendering.value = true
      await nextTick()
      await renderFlowchart(
        mermaidContainer.value,
        submission.value.mermaidCode,
      )
      rendering.value = false
    }
  } catch (error) {
    console.error("Failed to load submission:", error)
  } finally {
    loading.value = false
  }
}

watch(() => props.submissionId, loadSubmission, { immediate: true })
</script>

<style scoped>
.flowchart {
  height: 500px;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 全屏大图：覆盖整个视口，脱离弹框宽度限制 */
.flowchart-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 4000;
  width: 100vw;
  height: 100vh;
  padding: 32px;
  box-sizing: border-box;
  background: #ffffff;
  /* 改为可滚动块布局，超出视口的大图可以滚动查看 */
  display: block;
  overflow: auto;
}

.fullscreen-toolbar {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 4001;
}

/* 确保 SVG 图表占满容器 */
:deep(.flowchart > svg) {
  height: 100%;
}

/* 全屏时按自然尺寸显示并水平居中，配合容器滚动 */
:deep(.flowchart-fullscreen > svg) {
  display: block;
  margin: 0 auto;
  width: auto;
  height: auto;
  max-width: none;
}

.loading-container {
  min-height: 600px;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
