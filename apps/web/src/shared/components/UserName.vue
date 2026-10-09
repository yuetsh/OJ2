<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { USERNAME_CLASS_RE } from "utils/constants"

/**
 * 用户名：班级前缀（`ks253`）淡一档，名字加粗 —— 一个班的人前缀都一样，
 * 老师要认的是后面那段。`muted` 用在学生看别人的那几行（看得到结果、看不到代码）。
 */
const props = defineProps<{ username: string; muted?: boolean }>()

const theme = useThemeVars()

const parts = computed(() => {
  const match = props.username.match(USERNAME_CLASS_RE)
  if (!match) return { prefix: "", name: props.username }
  return { prefix: match[0], name: props.username.slice(match[0].length) || match[0] }
})
</script>

<template>
  <span class="user" :class="{ muted }" :title="username">
    <span v-if="parts.prefix" class="prefix">{{ parts.prefix }}</span>
    <span class="name">{{ parts.name }}</span>
  </span>
</template>

<style scoped>
.user {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.prefix {
  color: v-bind("theme.textColor3");
}

.name {
  font-weight: 600;
  color: v-bind("theme.textColor1");
}

.muted .name {
  font-weight: 400;
  color: v-bind("theme.textColor2");
}
</style>
