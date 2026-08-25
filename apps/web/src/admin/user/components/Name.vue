<script setup lang="ts">
import { PROBLEM_PERMISSION, USER_TYPE } from "utils/constants"
import { getUserRole } from "utils/functions"
import type { User } from "utils/types"
import TextCopy from "shared/components/TextCopy.vue"

interface Props {
  user: User
}
const props = defineProps<Props>()
const isNotRegularUser = computed(
  () => props.user.adminType !== USER_TYPE.REGULAR_USER,
)
</script>
<template>
  <n-flex align="center">
    <n-tag v-if="props.user.isDisabled" type="error" size="small">
      封号中
    </n-tag>
    <n-tag
      v-if="isNotRegularUser"
      :type="getUserRole(props.user.adminType).type"
      size="small"
    >
      {{ getUserRole(props.user.adminType).label }}
    </n-tag>
    <n-tag
      size="small"
      v-if="
        props.user.adminType === USER_TYPE.STUDENT_ADMIN ||
        props.user.adminType === USER_TYPE.TEACHER_ADMIN
      "
    >
      {{
        props.user.problemPermission === PROBLEM_PERMISSION.ALL
          ? "全部"
          : "仅自己"
      }}
    </n-tag>
    <TextCopy>{{ props.user.username }}</TextCopy>
  </n-flex>
</template>
