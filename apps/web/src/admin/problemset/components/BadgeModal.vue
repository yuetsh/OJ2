<script setup lang="ts">
import type { AdminProblemSetBadge } from "utils/types"

// 添加和编辑共用一个弹窗：传了 badge 就是编辑，null 就是添加。
// 原来是两份八成相同的组件，改一处表单项另一处总要漏
interface Props {
  show: boolean
  badge: AdminProblemSetBadge | null
}

type BadgeFormData = {
  name: string
  description: string
  icon: string
  conditionType: "all_problems" | "problem_count" | "score"
  conditionValue?: number
}

interface Emits {
  (e: "update:show", value: boolean): void
  (e: "create", data: BadgeFormData): void
  (e: "update", data: BadgeFormData): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const badgeName = ref("")
const badgeDescription = ref("")
const badgeIcon = ref("")
const badgeConditionType = ref<"all_problems" | "problem_count" | "score">("all_problems")
const badgeConditionValue = ref(1)

// 预设奖章图标选项
const BADGE_LEN = 6
const badgeIconOptions = []
for (let i = 1; i <= BADGE_LEN; i++) {
  badgeIconOptions.push({
    label: `奖章${i}`,
    value: `/badge-${i}.png`,
    icon: `/badge-${i}.png`,
  })
}

const conditionTypeOptions = [
  { label: "完成所有题目", value: "all_problems" },
  { label: "完成指定数量题目", value: "problem_count" },
  { label: "达到指定分数", value: "score" },
]

function handleConfirm() {
  const data: BadgeFormData = {
    name: badgeName.value,
    description: badgeDescription.value,
    icon: badgeIcon.value,
    conditionType: badgeConditionType.value,
    // 只有非"完成所有题目"时才带条件值
    ...(badgeConditionType.value === "all_problems"
      ? {}
      : { conditionValue: badgeConditionValue.value }),
  }
  if (props.badge) emit("update", data)
  else emit("create", data)
}

function handleCancel() {
  emit("update:show", false)
}

// 每次打开都按当前模式重新填表：编辑就填这枚奖章的值，添加就清空。
// 编辑取消后再打开同一枚，看到的是库里的值，而不是上次没保存的改动
watch(
  () => props.show,
  (open) => {
    if (!open) return
    const badge = props.badge
    badgeName.value = badge?.name ?? ""
    badgeDescription.value = badge?.description ?? ""
    badgeIcon.value = badge?.icon ?? ""
    badgeConditionType.value = badge?.conditionType ?? "all_problems"
    badgeConditionValue.value = badge?.conditionValue ?? 1
  },
  { immediate: true },
)
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="badge ? '编辑奖章' : '添加奖章'"
    style="width: 500px"
    @update:show="emit('update:show', $event)"
  >
    <n-form>
      <n-form-item label="奖章名称" required>
        <n-input v-model:value="badgeName" placeholder="请输入奖章名称" />
      </n-form-item>
      <n-form-item label="描述">
        <n-input v-model:value="badgeDescription" type="textarea" placeholder="奖章描述" required />
      </n-form-item>
      <n-form-item label="图标" required>
        <n-flex align="center" gap="small">
          <div
            v-for="option in badgeIconOptions"
            :key="option.value"
            @click="badgeIcon = option.value"
            :style="{
              width: '60px',
              height: '60px',
              border: badgeIcon === option.value ? '2px solid #1890ff' : '1px solid #d9d9d9',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: badgeIcon === option.value ? '#f0f8ff' : 'transparent',
            }"
          >
            <n-image
              :src="option.icon"
              width="50"
              height="50"
              object-fit="cover"
              preview-disabled
              style="border-radius: 2px"
            />
          </div>
        </n-flex>
      </n-form-item>
      <n-flex align="center">
        <n-form-item label="获得条件">
          <n-select
            style="width: 200px"
            v-model:value="badgeConditionType"
            :options="conditionTypeOptions"
          />
        </n-form-item>
        <n-form-item label="条件值" v-if="badgeConditionType !== 'all_problems'">
          <n-input-number
            style="width: 120px"
            v-model:value="badgeConditionValue"
            placeholder="条件值"
          />
        </n-form-item>
      </n-flex>
    </n-form>
    <template #footer>
      <n-flex justify="end">
        <n-button @click="handleCancel">取消</n-button>
        <n-button type="primary" @click="handleConfirm">确认</n-button>
      </n-flex>
    </template>
  </n-modal>
</template>
