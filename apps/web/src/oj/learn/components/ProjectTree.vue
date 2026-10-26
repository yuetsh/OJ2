<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { TutorialProgress } from '@oj2/contract'
import { lessonPath, lessonState, type ProjectGroup, type TutorialType } from '../lesson'
import LessonRow from './LessonRow.vue'
import ProjectTile from './ProjectTile.vue'

/**
 * 目录：按项目折叠，默认只展开正在学的那个项目（设计稿 A 的左栏、手机的目录抽屉）。
 * `big` 是手机那版：项目行高一些、带图标。
 */
const props = defineProps<{
  groups: ProjectGroup[]
  progress: Record<number, TutorialProgress>
  type: TutorialType
  currentStep: number
  big?: boolean
}>()
const emit = defineEmits<{ go: [] }>()

const open = ref(new Set<string>())

function keyOf(group: ProjectGroup) {
  return `${group.project}:${group.lessons[0]!.id}`
}

// 换课换到别的项目时，把那个项目也展开（别的已经展开的不收）
watch(
  () => [props.groups, props.currentStep] as const,
  ([groups, step]) => {
    const group = groups.find((item) => item.lessons.some((lesson) => lesson.step === step))
    if (group) open.value = new Set([...open.value, keyOf(group)])
  },
  { immediate: true },
)

function toggle(group: ProjectGroup) {
  const next = new Set(open.value)
  const key = keyOf(group)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  open.value = next
}

function doneIn(group: ProjectGroup) {
  return group.lessons.filter((lesson) => lessonState(props.progress[lesson.id]) === 'done').length
}
</script>

<template>
  <div class="tree" :class="{ big }">
    <template v-for="group in groups" :key="keyOf(group)">
      <button type="button" class="group" @click="toggle(group)">
        <ProjectTile v-if="big" :icon="group.icon" :tone="group.tone" :size="30" />
        <span v-else class="chev">
          <Icon :icon="open.has(keyOf(group)) ? 'ph:caret-down-bold' : 'ph:caret-right-bold'" :width="13" />
        </span>
        <span class="name">
          <span v-if="big && group.no" class="no">{{ group.no }}</span>
          <span class="label">
            <span v-if="!big && group.no" class="no-inline">{{ group.no.slice(2) }}</span>
            {{ group.name }}
          </span>
        </span>
        <span v-if="doneIn(group) === group.lessons.length" class="count all">
          <Icon icon="ph:check-bold" :width="12" />{{ doneIn(group) }}/{{ group.lessons.length }}
        </span>
        <span v-else class="count">{{ doneIn(group) }}/{{ group.lessons.length }}</span>
        <span v-if="big" class="chev">
          <Icon :icon="open.has(keyOf(group)) ? 'ph:caret-down-bold' : 'ph:caret-right-bold'" :width="14" />
        </span>
      </button>
      <div v-if="open.has(keyOf(group))" class="lessons">
        <LessonRow
          v-for="lesson in group.lessons"
          :key="lesson.id"
          :title="lesson.title"
          :step="lesson.step"
          :to="lessonPath(type, lesson.step)"
          :progress="progress[lesson.id]"
          :active="lesson.step === currentStep"
          :height="big ? 50 : 46"
          @go="emit('go')"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group {
  height: 36px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  text-align: left;
}
.group:hover {
  background: var(--learn-soft);
}
.big .group {
  height: 52px;
  gap: 10px;
  border-top: 1px solid var(--learn-line);
  border-radius: 0;
}
.chev {
  display: flex;
  opacity: 0.5;
}
.name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.label {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.big .label {
  font-size: 14px;
  font-weight: 700;
}
.no {
  font-size: 11px;
  opacity: 0.55;
}
.no-inline {
  font-weight: 400;
  opacity: 0.5;
  margin-right: 6px;
}
.count {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.count.all {
  opacity: 1;
  color: var(--learn-green-text);
  font-weight: 600;
}
.lessons {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 6px;
}
.big .lessons {
  padding: 0 0 8px;
}
</style>
