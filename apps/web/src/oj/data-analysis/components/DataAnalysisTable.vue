<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import type { DataAnalysisTableOutput } from '@oj2/contract'

/**
 * 运行器回的一张表（DataFrame / Series）。第一格是索引，灰字；文字列靠左、其余靠右，
 * 和 pandas 自己打出来的样子一致。行太多时运行器只给头尾，中间画一行 ⋯。
 * `limit` 只显示前几行（素材预览默认收着）。
 */
const { table, limit } = defineProps<{ table: DataAnalysisTableOutput; limit?: number }>()

const theme = useThemeVars()

const rows = computed(() => (limit ? table.rows.slice(0, limit) : table.rows))
const skipAt = computed(() => (limit ? null : table.skipAfter))
/** 一列全是数字（或空）就靠右 */
const numeric = computed(() => table.columns.map((_, j) => table.rows.every((row) => /^-?[\d.]+(e[+-]?\d+)?$|^NaN$/i.test(row[j + 1] ?? ''))))
</script>

<template>
  <div class="dataAnalysisTable">
    <table>
      <thead>
        <tr>
          <th class="ix"></th>
          <th v-for="(col, j) in table.columns" :key="j" :class="{ num: numeric[j] }">{{ col }}</th>
          <th v-if="table.colsTruncated" class="more">⋯</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(row, i) in rows" :key="i">
          <tr v-if="skipAt !== null && i === skipAt" class="skip">
            <td :colspan="table.columns.length + 1">⋯ 中间还有 {{ table.shape[0] - table.rows.length }} 行</td>
          </tr>
          <tr>
            <td class="ix">{{ row[0] }}</td>
            <td v-for="(cell, j) in row.slice(1)" :key="j" :class="{ num: numeric[j] }">{{ cell }}</td>
            <td v-if="table.colsTruncated" class="more"></td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.dataAnalysisTable {
  overflow-x: auto;
  max-width: 100%;
}

table {
  border-collapse: collapse;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

th,
td {
  padding: 4px 14px;
  text-align: left;
  white-space: nowrap;
}

th {
  font-weight: 600;
  border-bottom: 1px solid v-bind('theme.borderColor');
  background: v-bind('theme.tableHeaderColor');
}

td {
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.num {
  text-align: right;
}

.ix {
  color: v-bind('theme.textColor3');
  font-weight: 400;
}

.skip td,
.more {
  color: v-bind('theme.textColor3');
  text-align: center;
}
</style>
