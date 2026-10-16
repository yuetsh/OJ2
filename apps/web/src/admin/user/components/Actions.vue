<script lang="ts" setup>
import { editUser } from "admin/api"
import type { AdminUserForm } from "utils/types"
import { useBreakpoints } from "shared/composables/breakpoints"

/**
 * 用户列表一行的操作：重置密码、编辑、禁用、删除直接摆出来（用户说的：不要收进 ⋯）。
 * 删除前确认，交过题的账号删不掉，提示改为禁用
 */
interface Props {
  user: AdminUserForm
}
const props = defineProps<Props>()
const emit = defineEmits<{
  (e: "deleteUser", value: number[]): void
  (e: "userBanned", value: AdminUserForm): void
  (e: "openEditModal", value: AdminUserForm): void
  (e: "resetPassword", value: AdminUserForm): void
}>()

const dialog = useDialog()
// 手机上在卡片里，放不下一行就折下去
const { isMobile } = useBreakpoints()

async function banUser() {
  props.user.isDisabled = !props.user.isDisabled
  await editUser(props.user)
  emit("userBanned", props.user)
}

function confirmDelete() {
  dialog.warning({
    title: `删除 ${props.user.username}？`,
    content: "删掉就找不回来了。交过题的账号删不掉，那种请改为禁用。",
    positiveText: "删除",
    negativeText: "不删",
    onPositiveClick: () => emit("deleteUser", [props.user.id]),
  })
}
</script>
<template>
  <n-flex :size="6" :wrap="isMobile">
    <n-button size="small" @click="emit('resetPassword', props.user)">重置密码</n-button>
    <n-button size="small" @click="emit('openEditModal', props.user)">编辑</n-button>
    <n-button size="small" @click="banUser">
      {{ props.user.isDisabled ? "解除禁用" : "禁用" }}
    </n-button>
    <n-button size="small" quaternary type="error" @click="confirmDelete">删除</n-button>
  </n-flex>
</template>
