<script lang="ts" setup>
import TextCopy from "shared/components/TextCopy.vue"
import { USER_TYPE } from "utils/constants"
import type { User } from "utils/types"

interface Props {
  user: User
  revealed: boolean
}
const props = defineProps<Props>()
defineEmits<{
  (e: "toggle", value: number): void
}>()

/**
 * 只有**管理员账号**的密码需要打码。
 *
 * 学生的密码照旧直接显示 —— 老师查学生密码是日常动作（明文列 `raw_password` 就是为它
 * 保留的），挡一道只是添乱。要防的是管理员密码在投屏、或者旁人路过时被看到。
 *
 * `rawPassword` 为空时不打码：给一个点了什么也不显示的按钮没有意义，直接走原来的
 * TextCopy（渲染成空）。
 */
const maskable = computed(
  () =>
    props.user.adminType !== USER_TYPE.REGULAR_USER &&
    !!props.user.rawPassword,
)
</script>
<template>
  <!-- 显示出来之后要能再收回去：看一眼就该关掉，不然一整页管理员密码就那么摊着，
       只有翻页 / 搜索才会回到打码状态 -->
  <n-flex v-if="maskable" align="center" :size="6" :wrap="false">
    <span v-if="!props.revealed" class="dots">••••••</span>
    <TextCopy v-else>{{ props.user.rawPassword }}</TextCopy>
    <n-button size="tiny" secondary @click="$emit('toggle', props.user.id)">
      {{ props.revealed ? "隐藏" : "显示" }}
    </n-button>
  </n-flex>
  <TextCopy v-else>{{ props.user.rawPassword }}</TextCopy>
</template>
<style scoped>
/* 不加 nowrap 的话六个点会在窄列里折行，把整行撑高 */
.dots {
  white-space: nowrap;
  letter-spacing: 1px;
}
</style>
