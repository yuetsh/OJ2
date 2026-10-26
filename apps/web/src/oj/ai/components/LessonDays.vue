<script setup lang="ts">
import type { LearningDay } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { classLabel } from 'utils/classes'
import ProblemChip from './ProblemChip.vue'
import { dayLabel, isDone } from '../utils'

/** 一天一行，新的在前：先是班上这节课的题，再是这天自己练的 */
const props = defineProps<{
  days: LearningDay[]
  className: string | null
  username?: string
  /** 手机：日期单独一行，题目块在下面折行 */
  compact?: boolean
}>()

const theme = useThemeVars()

/** 一天自己练的超过这么多就先收起来；做得多的学生一天能自己刷二十几道 */
const OWN_CAP = 10
/** 「全部」能有上百天，先列这么多天 */
const DAY_CAP = 12

const openOwn = ref(new Set<string>())
const showAll = ref(false)
watch(
  () => props.days,
  () => {
    openOwn.value = new Set()
    showAll.value = false
  },
)

const shown = computed(() => (showAll.value ? props.days : props.days.slice(0, DAY_CAP)))
const you = computed(() => (props.username ? '' : '你'))
const subtitle = computed(() => (props.className ? `${classLabel(props.className)}课上做的题，加上${you.value}自己练的` : `${you.value}做过的题`))

function ownOf(day: LearningDay) {
  return openOwn.value.has(day.day) ? day.own : day.own.slice(0, OWN_CAP)
}

function expand(day: string) {
  openOwn.value = new Set([...openOwn.value, day])
}
</script>

<template>
  <section class="card" :class="{ compact }">
    <h3>
      每节课<small>{{ subtitle }}</small>
    </h3>
    <div v-for="day in shown" :key="day.day" class="day">
      <div class="when">
        <b>{{ dayLabel(day.day).date }}</b>
        <span>{{ dayLabel(day.day).weekday }}</span>
        <span v-if="compact && day.lesson.length" class="done"> 做对 {{ day.lesson.filter(isDone).length }}/{{ day.lesson.length }} </span>
      </div>
      <div class="groups">
        <div v-if="day.lesson.length" class="chips">
          <ProblemChip v-for="item in day.lesson" :key="item.displayId" :item="item" in-lesson :username="username" />
        </div>
        <div v-if="day.own.length" class="chips">
          <span class="own">自己练</span>
          <ProblemChip v-for="item in ownOf(day)" :key="item.displayId" :item="item" :in-lesson="false" :username="username" />
          <button v-if="day.own.length > OWN_CAP && !openOwn.has(day.day)" class="more" @click="expand(day.day)">
            还有 {{ day.own.length - OWN_CAP }} 道 ▾
          </button>
        </div>
      </div>
      <div v-if="!compact" class="done">
        <template v-if="day.lesson.length"> 做对 {{ day.lesson.filter(isDone).length }}/{{ day.lesson.length }} </template>
      </div>
    </div>
    <button v-if="!showAll && days.length > DAY_CAP" class="earlier" @click="showAll = true">更早的 {{ days.length - DAY_CAP }} 天 ▾</button>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 20px 6px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  background: v-bind('theme.cardColor');
}

h3 {
  margin: 0 0 8px;
  font-size: var(--oj-fs-h2);
  display: flex;
  align-items: baseline;
  gap: 10px;
}

h3 small {
  font-size: var(--oj-fs-meta);
  font-weight: 400;
  color: v-bind('theme.textColor3');
}

.day {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid v-bind('theme.dividerColor');
}

.when {
  width: 92px;
  flex-shrink: 0;
  line-height: 30px;
  white-space: nowrap;
}

.when b {
  font-size: var(--oj-fs-body);
  margin-right: 4px;
}

.when span {
  font-size: var(--oj-fs-meta);
  color: v-bind('theme.textColor3');
}

.groups {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.own {
  font-size: var(--oj-fs-meta);
  color: v-bind('theme.textColor3');
  margin-right: 2px;
}

.done {
  width: 72px;
  flex-shrink: 0;
  text-align: right;
  line-height: 30px;
  font-size: var(--oj-fs-meta);
  color: v-bind('theme.textColor3');
  font-variant-numeric: tabular-nums;
}

.more,
.earlier {
  height: 30px;
  padding: 0 12px;
  border: 1px dashed v-bind('theme.borderColor');
  border-radius: 6px;
  background: transparent;
  color: #18a058;
  font: inherit;
  font-size: var(--oj-fs-meta);
  cursor: pointer;
}

.earlier {
  width: 100%;
  margin: 4px 0 10px;
}

.compact {
  padding: 12px 14px 4px;
}

.compact .day {
  flex-direction: column;
  gap: 6px;
}

.compact .when {
  width: auto;
  display: flex;
  align-items: baseline;
  gap: 6px;
  line-height: 22px;
}

.compact .when .done {
  margin-left: auto;
  width: auto;
  line-height: 22px;
}
</style>
