<script setup lang="ts">
import { getSubmission } from "oj/api"
import type { JudgeCaseResult } from "@oj2/contract"
import { JUDGE_STATUS, LANGUAGE_FORMAT_VALUE, LANGUAGE_SHOW_VALUE } from "utils/constants"
import {
  parseTime,
  submissionCaseResults,
  submissionMemoryFormat,
  submissionResultTitle,
  submissionTimeFormat,
} from "utils/functions"
import type { Submission } from "utils/types"
import SubmissionResultTag from "shared/components/SubmissionResultTag.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useCopySubmission } from "./composables/copySubmission"

const props = defineProps<{
  submissionID: string
  problemID?: string
  submission?: Submission
  hideList?: boolean
}>()

// 在弹框中使用时，父组件监听此事件关闭弹框，否则弹框会挡住已更新的编辑器
const emit = defineEmits<{ copied: [] }>()

const { isMobile, isDesktop } = useBreakpoints()

const submission = ref<Submission>()
const loading = ref(false)

/**
 * 测试点明细。`info` 在契约里是「完整形状或空对象」的联合（非管理员拿到的是空对象），
 * `data` 本身也可能为 null —— 两种情况都由这个访问器归成空数组，模板里不再直接取。
 */
const caseResults = computed(() => submissionCaseResults(submission.value?.info))

async function init() {
  submission.value = props.submission
  if (submission.value) return
  loading.value = true
  const res = await getSubmission(props.submissionID)
  submission.value = res
  loading.value = false
}

const columns: DataTableColumn<JudgeCaseResult>[] = [
  { title: "测试用例", key: "test_case" },
  {
    title: "测试状态",
    key: "result",
    render: (row) => h(SubmissionResultTag, { result: row.result }),
  },
  {
    title: "占用内存",
    key: "memory",
    render: (row) => submissionMemoryFormat(row.memory),
  },
  {
    title: "执行耗时",
    key: "real_time",
    render: (row) => submissionTimeFormat(row.real_time),
  },
]

const { copyToCat: catCopy, copyToProblem: problemCopy } = useCopySubmission()

function copyToCat() {
  catCopy(submission.value!)
}

function copyToProblem() {
  problemCopy(submission.value!)
  emit("copied")
}

onMounted(init)
</script>

<template>
  <n-flex vertical v-if="submission" :size="24">
    <n-flex :vertical="isMobile" justify="space-between">
      <n-alert
        style="flex: 1"
        :type="JUDGE_STATUS[submission.result]['type']"
        :title="submissionResultTitle(submission)"
      >
        <n-flex>
          <span>提交时间：{{ parseTime(submission.createTime) }}</span>
          <span>编程语言：{{ LANGUAGE_SHOW_VALUE[submission.language] }}</span>
          <span>用户：{{ submission.username }}</span>
        </n-flex>
      </n-alert>
      <n-flex :vertical="isDesktop" justify="center">
        <n-button v-if="submission.language !== 'SQL'" secondary @click="copyToCat">
          复制到自测猫
        </n-button>
        <n-button secondary @click="copyToProblem">复制回到题目</n-button>
      </n-flex>
    </n-flex>
    <n-card embedded>
      <n-code
        class="code"
        :language="LANGUAGE_FORMAT_VALUE[submission.language]"
        :code="submission.code"
        show-line-numbers
      />
    </n-card>
    <n-data-table v-if="!hideList && caseResults.length" :columns="columns" :data="caseResults" />
  </n-flex>
  <n-spin v-else :show="loading" class="loading-container"> </n-spin>
</template>

<style scoped>
.code {
  font-size: 20px;
  overflow: auto;
}
.loading-container {
  min-height: 200px;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
