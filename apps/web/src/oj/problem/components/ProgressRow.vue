<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { ProblemProgress } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import AchievementIcon from "shared/components/AchievementIcon.vue"
import { useTone } from "oj/submission/composables/tone"

/**
 * 题目列表顶上那行的左半边：先说做到了什么（设计稿「题目列表重设计 · 改版」）。
 * 做对几道 · 这周新做对几道（这周还没有就说连续几周）· 离哪个成就最近 · 有几道差一点。
 * 没做对的题不常驻在这里：大多数学生一道「差一点」都没有（快照里 64%），常驻的话
 * 这行就只剩一言；有的人看见一排红色也是压力。点「差一点」才弹出来看。
 */
const props = defineProps<{
  progress: ProblemProgress
  /** 一道还没做对时引去的知识点（「输出入门」），没有这个标签就是 null */
  startTag: { name: string; problemCount: number } | null
  compact?: boolean
}>()

const emit = defineEmits<{ selectTag: [name: string] }>()

const theme = useThemeVars()
const tone = useTone()

const remaining = computed(() =>
  props.progress.next ? props.progress.next.threshold - props.progress.next.progress : 0,
)

/** 离成就还差什么，按指标换说法 */
const nextText = computed(() => {
  const next = props.progress.next
  if (!next) return ""
  const r = remaining.value
  switch (next.metric) {
    case "accepted_count":
      return next.progress === 0 ? "做对第一道题就解锁" : `再做对 ${r} 道就解锁`
    case "mid_ac_count":
      return `再做对 ${r} 道中等题就解锁`
    case "hard_ac_count":
      return `再做对 ${r} 道困难题就解锁`
    case "active_days":
      return `再来 ${r} 天就解锁`
    case "max_ac_week_streak":
      return `连续 ${next.threshold} 周有做对就解锁`
    default:
      return `还差 ${r} 就解锁`
  }
})

const weekChip = computed(() => {
  const p = props.progress
  if (p.weekSolved > 0) return `这周 +${p.weekSolved}`
  if (p.weekStreak >= 2) return `连续 ${p.weekStreak} 周都有做对`
  return ""
})

// 弹层在 body 下面，样式里的 v-bind 变量够不着，主题色就地给
const listVars = computed(() => ({
  "--list-text": theme.value.textColor1,
  "--list-id": theme.value.textColor3,
  "--list-hover": theme.value.hoverColor,
}))

const fresh = computed(() => props.progress.solved === 0)
</script>

<template>
  <div class="progress-row" :class="{ compact }">
    <template v-if="!fresh">
      <span class="total">
        你做对了<b>{{ progress.solved }}</b
        >道题
      </span>
      <span v-if="weekChip" class="chip">{{ weekChip }}</span>
    </template>
    <i v-if="!fresh && progress.next" class="sep"></i>
    <RouterLink v-if="progress.next" to="/achievement" class="next" title="去看我的成就">
      <AchievementIcon :icon="progress.next.icon" :size="16" />
      <span>
        {{ nextText }}<b>「{{ progress.next.name }}」</b>
      </span>
    </RouterLink>
    <button v-if="fresh && startTag" class="start" @click="emit('selectTag', startTag.name)">
      从「{{ startTag.name }}」开始，一共 {{ startTag.problemCount }} 道
      <Icon icon="ph:caret-right-bold" :width="12" />
    </button>
    <i v-if="!fresh && progress.almost.length" class="sep"></i>
    <n-popover v-if="!fresh && progress.almost.length" trigger="click" placement="bottom-start">
      <template #trigger>
        <button class="almost">
          有 {{ progress.almost.length }} 道差一点
          <Icon icon="ph:caret-right-bold" :width="12" />
        </button>
      </template>
      <div class="almost-list" :style="listVars">
        <RouterLink
          v-for="p in progress.almost"
          :key="p._id"
          :to="'/problem/' + p._id"
          class="almost-item"
        >
          <span class="id">{{ p._id }}</span>
          {{ p.title }}
        </RouterLink>
      </div>
    </n-popover>
  </div>
</template>

<style scoped>
.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  white-space: nowrap;
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.sep {
  flex: none;
  width: 1px;
  height: 14px;
  background: v-bind("theme.dividerColor");
}

.progress-row.compact {
  flex-wrap: wrap;
  gap: 6px 10px;
}

.progress-row.compact .sep {
  display: none;
}

.total {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.total b {
  font-size: 18px;
  font-weight: 700;
  color: v-bind("theme.successColor");
  font-variant-numeric: tabular-nums;
}

.chip {
  height: 24px;
  padding: 0 9px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  font-weight: 600;
  background: v-bind("tone('success').background");
  color: v-bind("tone('success').color");
}

.next {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: v-bind("theme.textColor2");
  text-decoration: none;
}

.next b {
  font-weight: 600;
  color: v-bind("theme.textColor1");
}

.next:hover b {
  color: v-bind("theme.primaryColor");
}

.almost {
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  color: v-bind("theme.textColor3");
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
}

.almost:hover {
  color: v-bind("theme.primaryColor");
}

.start {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  background: v-bind("theme.primaryColor");
  color: #fff;
  font: inherit;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.almost-list {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
  min-width: 200px;
}

.almost-item {
  padding: 6px 4px;
  border-radius: 4px;
  color: var(--list-text);
  text-decoration: none;
  font-size: 13px;
}

.almost-item:hover {
  background: var(--list-hover);
}

.almost-item .id {
  margin-right: 6px;
  color: var(--list-id);
  font-variant-numeric: tabular-nums;
}
</style>
