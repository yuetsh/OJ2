<script setup lang="ts">
import type { YearlyOverview, YearlySummary } from "utils/types"
import { getYearlyOverview } from "admin/api"
import { parseTime } from "utils/functions"
import "oj/learn/learn.css"

/**
 * 历年概况（原「年度趋势」，设计稿「卡点与趋势」页的定稿 TrendFinal）：一个学年一列。
 *
 * 学年从 9 月 1 日算起（原来按自然年切，一个学年被切成两半）。进行中的学年只有几个月，
 * 拿它和整年比没有意义，所以旁边并排一列「去年同期」。单道题的历年变化挪进了卡点分析的右栏。
 * 口径（人 × 题、一次就对、做对之前交了几次）见后端 routes/admin/analytics.ts。
 */
const data = ref<YearlyOverview | null>(null)
const loading = ref(false)

interface Column {
  key: string
  title: string
  sub: string
  kind: "full" | "current" | "last"
  row: YearlySummary
}

function yearLabel(year: number) {
  return `${String(year).slice(2)}–${String(year + 1).slice(2)}`
}

/** `until` 是开区间的终点，显示成「到 X 月 X 日」得往前退一毫秒 */
function untilText(until: string) {
  return `到 ${parseTime(new Date(Date.parse(until) - 1), "M月D日")}`
}

const columns = computed<Column[]>(() => {
  if (!data.value) return []
  const years = data.value.years
  const out: Column[] = years.map((row, index) => {
    const current = index === years.length - 1
    return {
      key: String(row.year),
      title: yearLabel(row.year),
      sub: current ? untilText(row.until) : "",
      kind: current ? "current" : "full",
      row,
    }
  })
  const last = data.value.lastYearToDate
  if (last)
    out.push({
      key: "last",
      title: "去年同期",
      sub: `${yearLabel(last.year)} ${untilText(last.until)}`,
      kind: "last",
      row: last,
    })
  return out
})

function ratio(part: number, whole: number, digits = 0) {
  return whole ? Number(((part / whole) * (digits ? 1 : 100)).toFixed(digits)) : 0
}

interface Line {
  label: string
  /** 给人看的 */
  text: (row: YearlySummary) => string
  /** 画小横条用的值，只给数量类的行 */
  value?: (row: YearlySummary) => number
}

const LINES: Line[] = [
  {
    label: "在用的年级",
    text: (row) => (row.grades.length ? row.grades.map((g) => `${g}`).join(" · ") + " 级" : "-"),
  },
  { label: "做题的学生", text: (row) => `${row.users} 人`, value: (row) => row.users },
  {
    label: "提交",
    text: (row) => `${row.submissions.toLocaleString("en-US")} 次`,
    value: (row) => row.submissions,
  },
  { label: "做过的题", text: (row) => `${row.problems} 道`, value: (row) => row.problems },
  {
    label: "人均做对",
    text: (row) => `${ratio(row.solvedPairs, row.users, 1)} 道`,
    value: (row) => ratio(row.solvedPairs, row.users, 1),
  },
  { label: "一次就对", text: (row) => `${ratio(row.firstTryPairs, row.startedPairs)}%` },
  {
    label: "做对平均交",
    text: (row) => (row.solvedStarted ? `${ratio(row.solvedTries, row.solvedStarted, 1)} 次` : "-"),
  },
  { label: "C / C++ 提交", text: (row) => `${ratio(row.cSubmissions, row.submissions)}%` },
]

/** 小横条只在完整学年之间比，进行中的和去年同期都只有几个月 */
function barWidth(line: Line, column: Column) {
  if (!line.value || column.kind !== "full") return null
  const max = Math.max(
    1,
    ...columns.value.filter((c) => c.kind === "full").map((c) => line.value!(c.row)),
  )
  return `${(line.value(column.row) / max) * 100}%`
}

function exportCsv() {
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`
  const head = ["", ...columns.value.map((c) => [c.title, c.sub].filter(Boolean).join(" "))]
  const rows = LINES.map((line) => [line.label, ...columns.value.map((c) => line.text(c.row))])
  const csv = [head, ...rows].map((row) => row.map(quote).join(",")).join("\r\n")
  // 带 BOM，Excel 才按 UTF-8 打开，不然中文是乱码
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = "历年概况.csv"
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  loading.value = true
  try {
    data.value = await getYearlyOverview()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <div class="top">
      <span class="title">历年概况</span>
      <span class="grow" />
      <n-button :disabled="!columns.length" @click="exportCsv">导出表格</n-button>
    </div>
    <n-spin :show="loading">
      <section class="card">
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th class="label muted">学年（9 月起）</th>
                <th v-for="column in columns" :key="column.key" :class="column.kind">
                  <div>{{ column.title }}</div>
                  <div v-if="column.sub" class="sub">{{ column.sub }}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in LINES" :key="line.label">
                <td class="label">{{ line.label }}</td>
                <td v-for="column in columns" :key="column.key" :class="column.kind" class="num">
                  <div>{{ line.text(column.row) }}</div>
                  <div v-if="barWidth(line, column)" class="track">
                    <span :style="{ width: barWidth(line, column)! }" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </n-spin>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title {
  font-size: 20px;
  font-weight: 700;
}
.grow {
  flex: 1;
}
.muted {
  opacity: 0.6;
}
.num {
  font-variant-numeric: tabular-nums;
}
.card {
  border: 1px solid var(--learn-line);
  border-radius: 8px;
  overflow: hidden;
}
.scroll {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  min-width: 900px;
}
th,
td {
  padding: 0 16px;
  text-align: right;
  white-space: nowrap;
}
th {
  height: 56px;
  font-size: 14px;
  font-weight: 700;
  vertical-align: bottom;
  padding-bottom: 10px;
}
td {
  height: 52px;
  border-top: 1px solid var(--learn-line);
}
.label {
  text-align: left;
  width: 130px;
}
th.label {
  font-size: 12px;
  font-weight: 400;
}
.sub {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.6;
}
.current {
  font-weight: 700;
  border-left: 1px solid var(--learn-line);
}
.last {
  opacity: 0.7;
}
.track {
  margin: 4px 0 0 auto;
  width: 88px;
  height: 5px;
  border-radius: 3px;
  background: var(--learn-todo);
  overflow: hidden;
}
.track > span {
  display: block;
  height: 100%;
  background: var(--learn-green-line);
}
</style>
