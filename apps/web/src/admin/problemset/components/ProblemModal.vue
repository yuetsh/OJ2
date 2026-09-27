<script setup lang="ts">
import type { AdminProblemSetProblem } from "utils/types"

// 添加和编辑共用一个弹窗：传了 problem 就是编辑，null 就是添加。
// 两种模式只差第一栏 —— 添加时填题目 ID，编辑时题目已定、只显示标题
interface Props {
  show: boolean
  problem: AdminProblemSetProblem | null
}

type ProblemFormData = {
  order: number
  isRequired: boolean
  score: number
  hint: string
}

interface Emits {
  (e: "update:show", value: boolean): void
  (e: "create", data: ProblemFormData & { problemId: string }): void
  (e: "update", data: ProblemFormData): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const problemId = ref("")
const problemOrder = ref(0)
const problemRequired = ref(true)
const problemScore = ref(0)
const problemHint = ref("")

function handleConfirm() {
  const data: ProblemFormData = {
    order: problemOrder.value,
    isRequired: problemRequired.value,
    score: problemScore.value,
    hint: problemHint.value,
  }
  if (props.problem) emit("update", data)
  else emit("create", { problemId: problemId.value, ...data })
}

function handleCancel() {
  emit("update:show", false)
}

// 每次打开都按当前模式重新填表：编辑就填这道题的值，添加就清空。
// 编辑取消后再打开同一道，看到的是库里的值，而不是上次没保存的改动
watch(
  () => props.show,
  (open) => {
    if (!open) return
    const problem = props.problem
    problemId.value = ""
    problemOrder.value = problem?.order ?? 0
    problemRequired.value = problem?.isRequired ?? true
    problemScore.value = problem?.score ?? 0
    problemHint.value = problem?.hint || ""
  },
  { immediate: true },
)
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="problem ? '编辑题目' : '添加题目'"
    style="width: 500px"
    @update:show="emit('update:show', $event)"
  >
    <n-form>
      <n-form-item v-if="problem" label="题目标题">
        <n-input :value="problem.title" disabled />
      </n-form-item>
      <n-form-item v-else label="题目ID" required>
        <n-input v-model:value="problemId" placeholder="请输入题目的显示ID（如：1001）" />
      </n-form-item>
      <n-form-item label="顺序">
        <n-input-number v-model:value="problemOrder" placeholder="题目在题单中的顺序" />
      </n-form-item>
      <n-form-item label="是否必做">
        <n-switch v-model:value="problemRequired" />
      </n-form-item>
      <n-form-item label="分数">
        <n-input-number v-model:value="problemScore" placeholder="题目分数" />
      </n-form-item>
      <n-form-item label="提示">
        <n-input v-model:value="problemHint" type="textarea" placeholder="题目提示" />
      </n-form-item>
    </n-form>
    <template #footer>
      <n-flex justify="end">
        <n-button @click="handleCancel">取消</n-button>
        <n-button type="primary" @click="handleConfirm">确认</n-button>
      </n-flex>
    </template>
  </n-modal>
</template>
