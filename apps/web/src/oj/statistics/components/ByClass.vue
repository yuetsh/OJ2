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
const props = defineProps<{
  grid: SubmissionStatisticsGrid
  /** 题号是老师填的。没填时「做完」没法谈（范围里各班各做各的题），改成「做对过题」 */
  explicit: boolean
}>()
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
  return (
    [...groups.entries()]
      .map(([className, rows]) => {
        let submissions = 0
        let accepted = 0
        let last = ""
        let done = 0
        for (const row of rows) {
          const solved = new Set(
            row.submissions
              .filter((item) => isAc(item.result))
              .map((item) => item.problemDisplayId),
          )
          if (props.explicit ? need.every((pid) => solved.has(pid)) : solved.size > 0) done++
          // 正确率的分母不算还在判的，和数字行一个口径
          submissions += row.submissions.filter(
            (item) =>
              item.result !== SubmissionStatus.pending && item.result !== SubmissionStatus.judging,
          ).length
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
          triedUsers: rows.length,
        }
      })
      // 交过的人多的在前（和题目页「各班做得怎样」一个顺序）：按最近一次排的话，
      // 零星一两个人补做的班会压在全班做过的班上面
      .sort((a, b) => b.triedUsers - a.triedUsers || b.last.localeCompare(a.last))
  )
})
</script>

<template>
  <div class="by-class">
    <div class="cols">
      <span class="c-class">班级</span>
      <span class="c-done">{{ explicit ? "做完" : "做对过题" }}</span>
      <span class="c-n">{{ explicit ? "交了没对" : "一道没对" }}</span>
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
      <p v-if="grid.truncated" class="note warn" :style="{ color: tone('warning').color }">
        范围太大，只取了最近的 5000 条提交，更早的班级可能少算或不在表里。缩短时间段就准了。
      </p>
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

/* 手机：这张表列多，横着滑 */
@media (max-width: 767px) {
  .by-class {
    flex: none;
    overflow-x: auto;
  }

  .cols,
  .row {
    min-width: 820px;
  }

  .rows {
    flex: none;
    overflow: visible;
  }
}
</style>
