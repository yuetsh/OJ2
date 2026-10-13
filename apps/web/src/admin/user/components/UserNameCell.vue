<script setup lang="ts">
import { PROBLEM_PERMISSION, USER_TYPE } from "utils/constants"
import { getUserRole } from "utils/functions"
import type { AdminUserForm } from "utils/types"
import TextCopy from "shared/components/TextCopy.vue"

interface Props {
  user: AdminUserForm
}
const props = defineProps<Props>()
const hasRoleTag = computed(() => props.user.adminType !== USER_TYPE.REGULAR_USER)
</script>
<template>
  <!-- 用户名在前（老师要认的是它），角色、禁用这些标签跟在后面 -->
  <n-flex align="center" :size="6" :wrap="false">
    <TextCopy>{{ props.user.username }}</TextCopy>
    <n-tag v-if="props.user.isDisabled" type="error" size="small" :bordered="false"> 已禁用 </n-tag>
    <n-tag
      v-if="hasRoleTag"
      :type="getUserRole(props.user.adminType).type"
      size="small"
      :bordered="false"
    >
      {{ getUserRole(props.user.adminType).label }}
    </n-tag>
    <n-tag
      v-if="
        props.user.adminType === USER_TYPE.STUDENT_ADMIN ||
        props.user.adminType === USER_TYPE.TEACHER_ADMIN
      "
      size="small"
      :bordered="false"
    >
      {{ props.user.problemPermission === PROBLEM_PERMISSION.ALL ? "全部题目" : "自己的题" }}
    </n-tag>
  </n-flex>
</template>
