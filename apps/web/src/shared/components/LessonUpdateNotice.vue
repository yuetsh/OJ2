<script setup lang="ts">
import type { LessonUpdate } from '@oj2/contract'
import { pendingLessonUpdate } from 'shared/composables/lessonUpdate'
import { useThemeVars } from 'naive-ui'
import { LANGUAGE_SHOW_VALUE } from 'utils/constants'

/**
 * 课上老师改了这节课的题：顶上居中一张卡，写清改了哪些，点「刷新」重新载入页面拿新的题单。
 * 不自己消失 —— 学生可能正低头写代码，几秒就没的提示等于没提示。代码草稿边写边存，刷新不丢。
 */
const update = pendingLessonUpdate
const theme = useThemeVars()

type Item = LessonUpdate['problems'][number]

function names(list: Item[]) {
  return list.map((item) => `${item.problemDisplayId} ${item.title}`).join('、')
}

function languageText(value: LessonUpdate) {
  return value.language ? LANGUAGE_SHOW_VALUE[value.language] : ''
}

const title = computed(() => {
  const value = update.value
  if (!value) return ''
  if (value.kind === 'assigned') return '老师布置了这节课的题'
  if (value.kind === 'cleared') return '老师清掉了这节课的题'
  return '老师改了这节课的题'
})

/** 一行一件事：加了哪些、去掉了哪些、语言、顺序 */
const lines = computed(() => {
  const value = update.value
  if (!value) return []
  if (value.kind === 'cleared') return []
  if (value.kind === 'assigned') {
    const language = languageText(value)
    return [{ label: '', text: names(value.problems) }, ...(language ? [{ label: '用', text: language }] : [])]
  }
  const result: { label: string; text: string }[] = []
  if (value.added.length) result.push({ label: '加了', text: names(value.added) })
  if (value.removed.length) result.push({ label: '去掉了', text: names(value.removed) })
  if (value.languageChanged) result.push({ label: '语言', text: value.language ? `改成 ${languageText(value)}` : '不限了' })
  if (value.reordered) result.push({ label: '', text: '换了题目的顺序' })
  return result
})

function refresh() {
  location.reload()
}

function dismiss() {
  update.value = null
}
</script>

<template>
  <Transition name="drop">
    <div v-if="update" class="notice" role="alert" :style="{ background: theme.cardColor, borderColor: theme.primaryColor }">
      <div class="title">{{ title }}</div>
      <div v-for="(line, index) in lines" :key="index" class="line">
        <span v-if="line.label" class="label">{{ line.label }}</span>
        <span>{{ line.text }}</span>
      </div>
      <div class="actions">
        <n-button quaternary @click="dismiss">先不刷新</n-button>
        <n-button type="primary" @click="refresh">刷新</n-button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.notice {
  position: fixed;
  /* 顶栏下面、居中：右上角是成就提示的位置，两个一起来不能叠上 */
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
  width: min(480px, calc(100vw - 32px));
  padding: 16px 20px;
  border-radius: var(--oj-radius);
  border: 2px solid;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  font-size: var(--oj-fs-body);
}
.title {
  font-size: var(--oj-fs-h2);
  font-weight: 700;
  margin-bottom: 8px;
}
.line {
  line-height: 1.7;
}
.label {
  font-weight: 600;
  margin-right: 8px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.drop-enter-active,
.drop-leave-active {
  transition: all 0.3s ease;
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translate(-50%, -16px);
}
</style>
