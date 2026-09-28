<script setup lang="ts">
import type { SqlDisplayColumn } from "utils/types"

defineProps<{
  columns: SqlDisplayColumn[]
  rows: (string | number | null)[][]
  totalRows?: number
  truncated?: boolean
}>()
</script>

<template>
  <!--
    列多的表横向滚动（设计文档第 8 节）。原来 n-table 固定占满宽度，列一多就把每一列
    挤成一两个字宽，列名和值都折成好几行，对不上哪个值是哪一列的
  -->
  <div class="sqlScroll">
    <n-table class="sqlTable" size="small" :single-line="false">
      <thead>
        <tr>
          <th v-for="(col, i) in columns" :key="i">
            {{ col.name }}
            <span v-if="col.type" class="colType">{{ col.type }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length" class="nullCell">（空表）</td>
        </tr>
        <tr v-for="(row, i) in rows" :key="i">
          <td v-for="(v, j) in row" :key="j" :class="{ nullCell: v === null }">
            {{ v === null ? "NULL" : v }}
          </td>
        </tr>
      </tbody>
    </n-table>
  </div>
  <p v-if="truncated" class="truncNote">共 {{ totalRows }} 行，仅展示前 {{ rows.length }} 行</p>
</template>

<style scoped>
.sqlScroll {
  overflow-x: auto;
  margin-bottom: 8px;
}

/* 按内容撑开、至少占满一行：列名和值都不折行，放不下就横向滚 */
.sqlTable {
  width: max-content;
  min-width: 100%;
}

.sqlTable :deep(th),
.sqlTable :deep(td) {
  white-space: nowrap;
}

.colType {
  font-size: 12px;
  opacity: 0.55;
  margin-left: 4px;
  font-weight: normal;
}

.nullCell {
  opacity: 0.45;
  font-style: italic;
}

.truncNote {
  font-size: 13px;
  opacity: 0.65;
  margin: 0 0 8px;
}
</style>
