<script setup lang="ts">
import { displayName } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { classLabel } from 'utils/classes'

/**
 * 学生的名字。显示的是用户名（学生改不了；真名早几届有人改成过外号），老号的 `ks232` 前缀剥掉不显示 ——
 * 班级单独存一列，前缀在界面上只是噪音。2026-11 起新号的用户名就是名字。
 *
 * `className` 给了就在名字后面淡写班级：一页上混着几个班（全服排名、全部提交、举手列表）时用，
 * 不同班同名的人（252、253 都有杨涵宇）靠它分开。一页只有一个班的别传。
 * `shortClass`：定宽的名字列（提交列表、排名赛道，带班号时 108px）里只写班号（`李鑫楠 2312`），全称放不下。
 * `muted` 用在学生看别人的那几行（看得到结果、看不到代码）。悬停看得到完整用户名。
 */
const props = defineProps<{ username: string; muted?: boolean; className?: string | null; shortClass?: boolean }>()
const theme = useThemeVars()
const name = computed(() => displayName(props.username))
</script>

<template>
  <span class="user" :class="{ muted }" :title="username">
    <span class="name">{{ name }}</span>
    <span v-if="className" class="klass">{{ shortClass ? className : classLabel(className) }}</span>
  </span>
</template>

<style scoped>
.user {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.name {
  font-weight: 600;
  color: v-bind('theme.textColor1');
}

.klass {
  margin-left: 6px;
  font-size: 0.85em;
  color: v-bind('theme.textColor3');
}

.muted .name {
  font-weight: 400;
  color: v-bind('theme.textColor2');
}
</style>
