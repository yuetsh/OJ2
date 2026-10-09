<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import type { BadgeBody } from "admin/api"
import type { AdminProblemSetBadge } from "utils/types"

/**
 * 加奖章 / 改奖章共用一个弹窗：传了 badge 就是改，null 就是加。
 * 条件只有两种：全部做完、做对 N 道（「总分达到 N」随分数一起拿掉了）。
 * 「做对 N 道」数的是做对的全部题（含选做），和后端 eligibleForBadge 同一个口径。
 */
const props = defineProps<{ badge: AdminProblemSetBadge | null; problemsCount: number }>()
const show = defineModel<boolean>("show", { required: true })
const emit = defineEmits<{ save: [data: BadgeBody] }>()
const theme = useThemeVars()

const ICONS = [1, 2, 3, 4, 5, 6].map((i) => `/badge-${i}.png`)

const form = reactive<BadgeBody>({
  name: "",
  description: "",
  icon: ICONS[0]!,
  conditionType: "problem_count",
  conditionValue: 1,
})

// 每次打开都按当前模式重新填表：改就填这枚奖章的值，加就清空
watch(show, (open) => {
  if (!open) return
  Object.assign(form, {
    name: props.badge?.name ?? "",
    description: props.badge?.description ?? "",
    icon: props.badge?.icon || ICONS[0]!,
    conditionType: props.badge?.conditionType ?? "problem_count",
    conditionValue: props.badge?.conditionValue || 1,
  })
})

const valid = computed(
  () =>
    form.name.trim().length > 0 &&
    (form.conditionType === "all_problems" || form.conditionValue >= 1),
)

function save() {
  if (!valid.value) return
  emit("save", {
    ...form,
    name: form.name.trim(),
    conditionValue: form.conditionType === "all_problems" ? 0 : form.conditionValue,
  })
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="badge ? '改奖章' : '加奖章'"
    style="width: 460px"
    :mask-closable="false"
  >
    <div class="form">
      <div class="field">
        <span class="label">图标</span>
        <div class="icons">
          <button
            v-for="icon in ICONS"
            :key="icon"
            class="icon"
            :class="{ on: form.icon === icon }"
            :aria-label="`选这个图标`"
            @click="form.icon = icon"
          >
            <img :src="icon" alt="" />
          </button>
        </div>
      </div>
      <div class="field">
        <span class="label">名字</span>
        <n-input v-model:value="form.name" placeholder="比如 人上人" maxlength="100" />
      </div>
      <div class="field">
        <span class="label">说明</span>
        <n-input v-model:value="form.description" placeholder="选填，学生拿到时看得到" />
      </div>
      <div class="field">
        <span class="label">条件</span>
        <n-radio-group v-model:value="form.conditionType">
          <n-radio-button value="problem_count">做对几道</n-radio-button>
          <n-radio-button value="all_problems">全部做完</n-radio-button>
        </n-radio-group>
        <n-input-number
          v-if="form.conditionType === 'problem_count'"
          v-model:value="form.conditionValue"
          :min="1"
          :max="Math.max(1, problemsCount)"
          style="width: 110px"
        >
          <template #suffix>道</template>
        </n-input-number>
      </div>
      <span class="hint">
        {{
          form.conditionType === "all_problems"
            ? "必做题全部做对就发。"
            : "做对的题（选做也算）够这个数就发。"
        }}改了条件会按大家现在的进度重新发、收。
      </span>
    </div>
    <template #footer>
      <n-flex justify="end">
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" :disabled="!valid" @click="save">保存</n-button>
      </n-flex>
    </template>
  </n-modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.label {
  width: 36px;
  flex-shrink: 0;
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.icons {
  display: flex;
  gap: 6px;
}

.icon {
  width: 40px;
  height: 40px;
  padding: 3px;
  border-radius: 6px;
  border: 2px solid transparent;
  background: transparent;
  cursor: pointer;
}

.icon.on {
  border-color: v-bind("theme.primaryColor");
}

.icon img {
  width: 30px;
  height: 30px;
}

.hint {
  font-size: 12px;
  line-height: 1.6;
  color: v-bind("theme.textColor3");
}
</style>
