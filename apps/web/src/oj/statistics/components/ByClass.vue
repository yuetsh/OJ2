<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import type { SubmissionStatisticsGrid } from "@oj2/contract"
import { SubmissionStatus } from "utils/constants"
import { useTone } from "oj/submission/composables/tone"
import { classLabel, submissionDayText } from "oj/submission/utils"

/**
 * 没选班级、也没填学生时（多半是从题目页进来，只带了题号）：先按班级列出来，
 * 点一个班再看人。「一道没交」要花名册人数，后端在这种情况下给 classSizes。
 */
const props = defineProps<{ grid: SubmissionStatisticsGrid }>()
const emit = defineEmits<{ pick: [className: string] }>()

const theme = useThemeVars()
const tone = useTone()

function isAc(result: number) {
  return result === SubmissionStatus.accepted || result === SubmissionStatus.ast_check_failed
}

const classes = computed(() => {
  const need = props.grid.problems.map((problem) => problem.problemDisplayId)
  const groups = new Map<string, SubmissionStatisticsGrid["rows"]>()
  for (const row of props.grid.rows) {
    const key = row.className ?? ""
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()]
    .map(([className, rows]) => {
      let submissions = 0
      let accepted = 0
      let last = ""
      let done = 0
      for (const row of rows) {
        const solved = new Set(
          row.submissions.filter((item) => isAc(item.result)).map((item) => item.problemDisplayId),
        )
        if (need.every((pid) => solved.has(pid))) done++
        submissions += row.submissions.length
        accepted += row.submissions.filter((item) => isAc(item.result)).length
        const lastTime = row.submissions.at(-1)?.createTime ?? ""
        if (lastTime > last) last = lastTime
      }
      const size = props.grid.classSizes[className] ?? rows.length
      return {
        className,
        label: className ? classLabel(className) : "没有班级",
        size,
        done,
        tried: rows.length - done,
        none: Math.max(0, size - rows.length),
        rate: submissions ? `${Math.round((accepted / submissions) * 100)}%` : "—",
        last,
      }
    })
    .sort((a, b) => b.last.localeCompare(a.last))
})
</script>

<template>
  <div class="by-class">
    <div class="cols">
      <span class="c-class">班级</span>
      <span class="c-done">做完</span>
      <span class="c-n">交了没对</span>
      <span class="c-n">没交</span>
      <span class="c-n">正确率</span>
      <span class="c-last">最近一次</span>
      <span class="spacer"></span>
    </div>
    <div class="rows">
      <div v-for="row in classes" :key="row.className" class="row">
        <b class="c-class">{{ row.label }}</b>
        <span class="c-done">
          <span class="bar">
            <span
              class="fill"
              :style="{ width: `${row.size ? (row.done / row.size) * 100 : 0}%` }"
            ></span>
          </span>
          <span class="num">{{ row.done }}/{{ row.size }}</span>
        </span>
        <span class="c-n" :style="{ color: tone('warning').color }">{{ row.tried }}</span>
        <span class="c-n" :style="{ color: tone('error').color }">{{ row.none }}</span>
        <span class="c-n muted">{{ row.rate }}</span>
        <span class="c-last muted">{{ row.last ? submissionDayText(row.last) : "—" }}</span>
        <span class="spacer"></span>
        <n-button
          v-if="row.className"
          size="small"
          text
          type="primary"
          @click="emit('pick', row.className)"
        >
          看这个班 →
        </n-button>
      </div>
      <div v-if="!classes.length" class="empty">这段时间没有人交</div>
      <p class="note">没选班级，先按班级列出来；点一个班再看每个人。「做完」是这几道题都做对了。</p>
    </div>
  </div>
</template>

<style scoped>
.by-class {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.cols {
  height: 32px;
  flex: none;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.rows {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

.row {
  height: 44px;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.c-class {
  width: 140px;
  flex: none;
}

.c-done {
  width: 240px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
}

.c-n {
  width: 90px;
  flex: none;
}

.c-last {
  width: 110px;
  flex: none;
}

.bar {
  width: 150px;
  height: 6px;
  border-radius: 3px;
  background: v-bind("theme.dividerColor");
  overflow: hidden;
}

.fill {
  display: block;
  height: 6px;
  background: v-bind("theme.successColor");
}

.num {
  font-variant-numeric: tabular-nums;
}

.muted {
  color: v-bind("theme.textColor3");
}

.spacer {
  flex: 1 1 0;
}

.empty {
  padding: 40px 16px;
  text-align: center;
  color: v-bind("theme.textColor3");
}

.note {
  margin: 0;
  padding: 10px 20px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
}
</style>
