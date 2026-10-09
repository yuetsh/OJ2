<script setup lang="ts">
import { useThemeVars } from "naive-ui"

/**
 * 榜单上的名字：`ks241` 前缀淡一点，后面的名字是重点（和提交列表一个写法）。
 * 前缀对不上班级号就整个照常显示
 */
const props = defineProps<{ username: string; className?: string | null; strong?: boolean }>()

const theme = useThemeVars()

const parts = computed(() => {
  const prefix = props.className ? `ks${props.className}` : ""
  if (prefix && props.username.startsWith(prefix) && props.username.length > prefix.length) {
    return [prefix, props.username.slice(prefix.length)]
  }
  return ["", props.username]
})
</script>

<template>
  <span class="user" :title="username"
    ><span class="prefix">{{ parts[0] }}</span
    ><span class="name" :class="{ strong }">{{ parts[1] }}</span></span
  >
</template>

<style scoped>
.user {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prefix {
  color: v-bind("theme.textColor3");
}

.name {
  color: v-bind("theme.textColor1");
}

.name.strong {
  font-weight: 700;
}
</style>
