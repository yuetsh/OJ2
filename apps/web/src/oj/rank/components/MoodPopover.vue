<script setup lang="ts">
import { MOOD_MAX } from "@oj2/contract"
import { updateProfile } from "oj/api"
import { useUserStore } from "shared/store/user"

/**
 * 就地改个性签名：「你」卡上的签名、赛道里自己那行的「写一句个性签名」点开的是同一个框。
 * 触发按钮由调用方放进默认插槽。
 */
const props = defineProps<{ mood: string | null }>()
const emit = defineEmits<{ saved: [mood: string | null] }>()

const message = useMessage()
const userStore = useUserStore()
const inputId = useId()

const editing = ref(false)
const draft = ref("")
const saving = ref(false)

watch(editing, (open) => {
  if (open) draft.value = props.mood ?? ""
})

async function save() {
  const mood = draft.value.trim()
  if (mood.length > MOOD_MAX) {
    message.warning(`个性签名最多 ${MOOD_MAX} 个字`)
    return
  }
  saving.value = true
  try {
    await updateProfile({ mood })
    if (userStore.profile) userStore.profile.mood = mood || null
    emit("saved", mood || null)
    editing.value = false
    message.success(mood ? "签名改好了" : "签名清空了")
  } catch {
    message.error("没保存上，再试一次")
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <n-popover
    v-model:show="editing"
    trigger="click"
    placement="bottom-start"
    :style="{ width: '300px' }"
  >
    <template #trigger>
      <slot />
    </template>
    <form class="mood-form" @submit.prevent="save">
      <label class="mood-label" :for="inputId">个性签名</label>
      <n-input
        v-model:value="draft"
        :input-props="{ id: inputId }"
        :maxlength="MOOD_MAX"
        show-count
        clearable
        placeholder="写点什么，让大家认识你"
        autofocus
      />
      <div class="mood-actions">
        <n-button size="small" @click="editing = false">取消</n-button>
        <n-button size="small" type="primary" attr-type="submit" :loading="saving"> 保存 </n-button>
      </div>
    </form>
  </n-popover>
</template>

<style scoped>
.mood-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mood-label {
  font-size: var(--oj-fs-sec);
  font-weight: 600;
}

.mood-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
