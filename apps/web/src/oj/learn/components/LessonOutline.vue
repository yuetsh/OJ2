<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { OutlineItem } from '../composables/useLessonParse'

/**
 * 右边「这一课」：各节标题，有练一练的节后面挂一支笔（做对了再打个勾），
 * 读到哪一节哪一节变绿。底下是这课练一练做到几道。
 */
const props = defineProps<{
  items: OutlineItem[]
  activeId: string
  solvedIds: Set<number>
  exerciseCount: number
}>()
const emit = defineEmits<{ jump: [id: string] }>()

const solvedCount = computed(() => props.items.flatMap((item) => item.exerciseIds).filter((id) => props.solvedIds.has(id)).length)

function allSolved(item: OutlineItem) {
  return item.exerciseIds.every((id) => props.solvedIds.has(id))
}
</script>

<template>
  <nav class="outline" aria-label="这一课">
    <div class="title">这一课</div>
    <a v-for="item in items" :key="item.id" :href="`#${item.id}`" class="item" :class="{ active: item.id === activeId }" @click.prevent="emit('jump', item.id)">
      <span class="mark" />
      <span class="text">{{ item.text }}</span>
      <span v-if="item.exerciseIds.length" class="ex" :class="{ ok: allSolved(item) }">
        <Icon icon="ph:pencil-simple" :width="12" />
        <Icon v-if="allSolved(item)" icon="ph:check-bold" :width="12" />
      </span>
    </a>
    <div v-if="exerciseCount" class="practice">
      <div class="practice-head">
        <span>练一练</span>
        <span class="num">{{ solvedCount }} / {{ exerciseCount }}</span>
      </div>
      <div class="boxes">
        <span v-for="n in exerciseCount" :key="n" class="box" :class="{ on: n <= solvedCount }" />
      </div>
    </div>
  </nav>
</template>

<style scoped>
.outline {
  display: flex;
  flex-direction: column;
}
.title {
  font-size: 12px;
  font-weight: 700;
  opacity: 0.55;
  margin-bottom: 6px;
}
.item {
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: inherit;
  text-decoration: none;
  opacity: 0.85;
}
.item:hover {
  opacity: 1;
}
.item.active {
  color: var(--learn-green-text);
  font-weight: 700;
  opacity: 1;
}
.mark {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.active .mark {
  background: var(--learn-green);
}
.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ex {
  display: inline-flex;
  gap: 1px;
  opacity: 0.5;
}
.ex.ok {
  opacity: 1;
  color: var(--learn-green-text);
}
.practice {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--learn-line);
}
.practice-head {
  display: flex;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}
.num {
  font-weight: 400;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.boxes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.box {
  width: 28px;
  height: 8px;
  border-radius: 4px;
  background: var(--learn-todo);
}
.box.on {
  background: var(--learn-green);
}
</style>
