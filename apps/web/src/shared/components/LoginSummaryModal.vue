<script setup lang="ts">
import { useBreakpoints } from "shared/composables/breakpoints"
import { useLoginSummaryStore } from "shared/store/loginSummary"
import { parseTime } from "utils/functions"

// md-editor-v3 按需加载：这个弹框挂在默认布局上，静态 import 的话首页每次都要多拉
// ~160KB JS + ~76KB CSS，而 AI 分析只在登录后、且期间提交够 3 次才有
const MdPreview = defineAsyncComponent(() => import("./LoginSummaryPreview.vue"))

const loginSummaryStore = useLoginSummaryStore()
const { isDesktop } = useBreakpoints()

const lastLoginTime = computed(() => {
  const summary = loginSummaryStore.summary
  if (!summary?.start) {
    return ""
  }
  return parseTime(summary.start, "YYYY-MM-DD HH:mm")
})

const hasAnalysis = computed(() => !!loginSummaryStore.analysis)
</script>

<template>
  <n-modal
    v-model:show="loginSummaryStore.show"
    preset="card"
    title="登录速报"
    style="width: min(760px, 92vw)"
  >
    <n-spin :show="loginSummaryStore.loading" size="small">
      <n-flex vertical size="large">
        <n-text v-if="lastLoginTime">上次登录时间：{{ lastLoginTime }}</n-text>
        <n-grid :cols="isDesktop ? 3 : 1" :x-gap="16" :y-gap="16">
          <n-gi>
            <n-statistic
              label="新增题目"
              :value="loginSummaryStore.summary?.newProblemCount ?? 0"
            />
          </n-gi>
          <n-gi>
            <n-statistic
              label="提交次数"
              :value="loginSummaryStore.summary?.submissionCount ?? 0"
            />
          </n-gi>
          <n-gi>
            <n-statistic label="AC 次数" :value="loginSummaryStore.summary?.acceptedCount ?? 0" />
          </n-gi>
          <n-gi>
            <n-statistic label="AC 题目数" :value="loginSummaryStore.summary?.solvedCount ?? 0" />
          </n-gi>
          <n-gi>
            <n-statistic
              label="流程图提交"
              :value="loginSummaryStore.summary?.flowchartSubmissionCount ?? 0"
            />
          </n-gi>
        </n-grid>

        <n-divider>AI 分析</n-divider>
        <n-alert v-if="loginSummaryStore.analysisError" type="warning" :show-icon="false">
          {{ loginSummaryStore.analysisError }}
        </n-alert>
        <MdPreview v-if="hasAnalysis" :model-value="loginSummaryStore.analysis" />
        <n-empty v-else description="期间提交数少于 3 次，暂不生成 AI 分析" />
      </n-flex>
    </n-spin>
  </n-modal>
</template>
