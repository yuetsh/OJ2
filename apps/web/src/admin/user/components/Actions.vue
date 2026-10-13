<script lang="ts" setup>
import { Icon } from "@iconify/vue"
import { editUser } from "admin/api"
import type { AdminUserForm } from "utils/types"

/**
 * 用户列表一行的操作（设计稿「后台用户与批量建号」UsList）：最常用的「重置密码」常驻
 * （学生忘了密码是后台进得最多的一件事），其余收进 ⋯。原来四颗彩色按钮并排，
 * 1366 的屏上把「上次登录」挤成了半截
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

async function banUser() {
  props.user.isDisabled = !props.user.isDisabled
  await editUser(props.user)
  emit("userBanned", props.user)
}

const menuOptions = computed<DropdownOption[]>(() => [
  { label: "编辑", key: "edit" },
  { label: props.user.isDisabled ? "解除禁用" : "禁用", key: "ban" },
  { type: "divider", key: "divider" },
  { label: "删除", key: "delete" },
])

function onMenu(key: string) {
  if (key === "edit") emit("openEditModal", props.user)
  else if (key === "ban") banUser()
  else if (key === "delete") {
    dialog.warning({
      title: `删除 ${props.user.username}？`,
      content: "删掉就找不回来了。交过题的账号删不掉，那种请改为禁用。",
      positiveText: "删除",
      negativeText: "不删",
      onPositiveClick: () => emit("deleteUser", [props.user.id]),
    })
  }
}
</script>
<template>
  <n-flex :size="4" justify="end" :wrap="false">
    <n-button size="small" @click="emit('resetPassword', props.user)">重置密码</n-button>
    <n-dropdown trigger="click" placement="bottom-end" :options="menuOptions" @select="onMenu">
      <n-button size="small" quaternary aria-label="更多">
        <template #icon><Icon icon="ph:dots-three-bold" /></template>
      </n-button>
    </n-dropdown>
  </n-flex>
</template>
