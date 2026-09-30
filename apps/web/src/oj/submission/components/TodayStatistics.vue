<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { getTodaySubmissionStatistics } from "oj/api"
import { parseTime, zonedParts } from "utils/functions"
import type { TodaySubmissionStatistics } from "utils/types"

/**
 * 今日统计（设计稿「今日统计重设计」学生版），**只给学生**：自己今天怎样、大家在做哪几道。
 * 老师那一版（今天哪几个班上了课、几点到几点、错得最多的题）2026-09 并进了「统计」的
 * 「一行一节课」（oj/statistics/components/Lessons.vue），老师的提交列表上不再有这颗标签。
 */
const emit = defineEmits<{
  close: []
  openProblem: [problem: string]
  /** 拉到数之后把总数报回去：按钮上的数只在进页面时拉过一次，停久了会对不上 */
  loaded: [total: number]
}>()

const theme = useThemeVars()

const stats = ref<TodaySubmissionStatistics | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    stats.value = await getTodaySubmissionStatistics()
    emit("loaded", stats.value.total)
  } catch {
    failed.value = true
  }
})

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

const headText = computed(() => {
  const at = stats.value?.asOf ?? new Date().toISOString()
  const p = zonedParts(at)!
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]
  return `${p.month}月${p.day}日 ${weekday} · 截至 ${parseTime(at, "HH:mm")}`
})

const meText = computed(() => {
  const me = stats.value?.me
  if (!me) return ""
  return me.total ? `交了 ${me.total} 次，做对 ${me.solved} 道` : "还没交过"
})
</script>

<template>
  <div class="today">
    <div class="head">
      <b class="title">今日统计</b>
      <n-text depth="3" class="small">{{ headText }}</n-text>
      <span v-if="stats?.judging" class="pill">判题中 {{ stats.judging }}</span>
      <span class="spacer"></span>
      <button type="button" class="close" aria-label="关闭" @click="emit('close')">
        <Icon icon="ph:x" :width="18" />
      </button>
    </div>

    <div class="body">
      <n-text v-if="failed" type="error">统计没拉下来，关掉再打开试试</n-text>
      <div v-else-if="!stats" class="center"><n-spin size="small" /></div>

      <div v-else-if="!stats.total" class="empty">
        <span class="empty-icon"><Icon icon="ph:chart-bar" :width="20" /></span>
        <b>今天还没有人交</b>
        <n-text depth="3">第一条提交进来之后这里就有数了</n-text>
      </div>

      <template v-else>
        <div v-if="meText" class="me">
          <b>你今天</b>
          <n-text depth="2">{{ meText }}</n-text>
        </div>
        <div class="numbers">
          <div>
            <b>{{ stats.total }}</b
            ><span>次提交</span>
          </div>
          <div>
            <b>{{ stats.userCount }}</b
            ><span>人交了题</span>
          </div>
          <div>
            <b>{{ Math.round(stats.correctRate) }}%</b><span>提交做对了</span>
          </div>
        </div>
        <template v-if="stats.problems.length">
          <b class="section-title">今天大家都在做</b>
          <div class="rows">
            <a
              v-for="item in stats.problems"
              :key="item.problemDisplayId"
              href="#"
              class="row"
              @click.prevent="emit('openProblem', item.problemDisplayId)"
            >
              <span class="row-title">
                <n-text depth="3">{{ item.problemDisplayId }}</n-text> {{ item.problemTitle }}
              </span>
              <n-text depth="3" class="small">
                {{ item.userCount }} 人做 · {{ item.acceptedUsers }} 人对
              </n-text>
              <span v-if="item.mine === 'accepted'" class="mine done">
                <Icon icon="ph:check-bold" :width="12" />做对了
              </span>
              <span v-else class="mine go">{{ item.mine === "tried" ? "接着做" : "去做" }} ›</span>
            </a>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.today {
  width: min(560px, calc(100vw - 32px));
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: v-bind("theme.cardColor");
  box-shadow: v-bind("theme.boxShadow3");
  font-size: 14px;
  overflow: hidden;
}

.head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 14px 24px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.title {
  font-size: 18px;
}

.pill {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor2");
}

.spacer {
  flex: 1 1 0;
}

.close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: v-bind("theme.textColor2");
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.close:hover {
  background: v-bind("theme.actionColor");
}

.body {
  overflow: auto;
  padding: 18px 24px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.small {
  font-size: 13px;
}

.center {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.empty {
  padding: 40px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.empty-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor2");
}

.numbers {
  display: flex;
  gap: 36px;
  flex-wrap: wrap;
}

.numbers > div {
  display: flex;
  flex-direction: column;
}

.numbers b {
  font-size: 26px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.numbers span {
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.section-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.me {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  background: v-bind("theme.actionColor");
}

.rows {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 2px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mine {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.mine.done {
  color: v-bind("theme.successColor");
}

.mine.go {
  color: v-bind("theme.primaryColor");
}
</style>
