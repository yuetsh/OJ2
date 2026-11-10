<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import { useTone } from 'shared/composables/tone'

/**
 * 提交列表右栏顶行的「只看这个人 / 这个班 / 这道题」。
 *
 * 平时只是一个灰色的漏斗，跟在它筛的那样东西后面，悬停才上色 —— 原来三个都是绿边胶囊、
 * 班级那个还是带字的另一种形状，和绿色的名字、题目挤在一行里，分不出哪个是字哪个是按钮。
 * `label` 给班级用：班级没有别的地方可去，字和漏斗是同一个按钮。
 * `active` 是已经在筛它了：漏斗换成 ×，点一下取消。
 */
defineProps<{
  title: string
  label?: string
  active?: boolean
  /** 手机上用手指点，放大一圈 */
  large?: boolean
}>()

const theme = useThemeVars()
const tone = useTone()
</script>

<template>
  <button class="filter" :class="{ active, large, labelled: !!label }" :title="title" :aria-label="title">
    <span v-if="label" class="label">{{ label }}</span>
    <span class="mark"><Icon :icon="active ? 'ph:x-bold' : 'ph:funnel-simple-bold'" :width="large ? 16 : 14" /></span>
  </button>
</template>

<style scoped>
.filter {
  flex: none;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: var(--oj-fs-sec);
  color: v-bind('theme.textColor3');
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}

/* 右栏窄了先截班级的字，漏斗留着 */
.labelled {
  flex: 0 1 auto;
}

.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: v-bind('theme.textColor2');
}

.mark {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.large .mark {
  width: 30px;
  height: 30px;
}

.filter:hover,
.filter:hover .label,
.active,
.active .label {
  color: v-bind("tone('success').color");
}

.filter:hover .mark,
.active .mark {
  background: v-bind("tone('success').background");
}

.active:hover,
.active:hover .label {
  color: v-bind("tone('error').color");
}

.active:hover .mark {
  background: v-bind("tone('error').background");
}

.filter:focus-visible {
  outline: 2px solid v-bind('theme.primaryColor');
  outline-offset: 2px;
  border-radius: 11px;
}
</style>
