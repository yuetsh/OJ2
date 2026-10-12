<script setup lang="ts">
import type { LearningReport } from "@oj2/contract"
import { useThemeVars } from "naive-ui"

/** 顶上一排数：做对几道、一次就对、上了几节课、差一点的；老师看时最前面多一格「班上第几」 */
const props = defineProps<{ report: LearningReport; teacher: boolean; compact?: boolean }>()

const theme = useThemeVars()

interface Cell {
  big: number
  unit: string
  sub: string
  warn?: boolean
}

const cells = computed(() => {
  const r = props.report
  const c = r.classStats
  const percent = r.solved ? Math.round((r.firstTry / r.solved) * 100) : 0
  const firstSub = `一次就对 · 占 ${percent}%`
  const list: Cell[] = [
    { big: r.solved, unit: "道", sub: c ? `做对 · 班上中间那位 ${c.medianSolved} 道` : "做对" },
    {
      big: r.firstTry,
      unit: "道",
      sub: c && !props.compact ? `${firstSub}，班上中间那位 ${c.medianFirstPercent}%` : firstSub,
    },
    { big: r.lessonCount, unit: "节课", sub: `交了 ${r.submissionCount} 次` },
  ]
  if (r.unsolved.length)
    list.push({ big: r.unsolved.length, unit: "道", sub: "差一点 · 交过还没做对", warn: true })
  if (props.teacher && c)
    list.unshift({ big: c.rank, unit: `/ ${c.size}`, sub: "班上按做对题数排第几" })
  return list
})
</script>

<template>
  <div class="strip" :class="{ compact }">
    <div v-for="cell in cells" :key="cell.sub" class="cell">
      <div class="num">
        <b :class="{ warn: cell.warn }">{{ cell.big }}</b>
        <span>{{ cell.unit }}</span>
      </div>
      <div class="sub">{{ cell.sub }}</div>
    </div>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
}

.cell {
  flex: 1;
  min-width: 0;
  padding: 14px 20px;
  border-left: 1px solid v-bind("theme.dividerColor");
}

.cell:first-child {
  border-left: 0;
}

.num {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.num b {
  font-size: 30px;
  line-height: 38px;
  font-variant-numeric: tabular-nums;
}

.num b.warn {
  color: #c27c0e;
}

.num span {
  font-size: var(--oj-fs-body);
}

.sub {
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
}

.compact {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.compact .cell {
  padding: 10px 12px;
  border-left: 0;
}

.compact .num b {
  font-size: 26px;
  line-height: 32px;
}
</style>
