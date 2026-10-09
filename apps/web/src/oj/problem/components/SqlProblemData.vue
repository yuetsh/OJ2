<script setup lang="ts">
import type { SqlDisplay } from "utils/types"
import { tableChanges } from "../utils/sqlChanges"
import SQLDataTable from "./SQLDataTable.vue"

/**
 * SQL 题题面里的「数据表」和「期望结果」。题目页和后台出题页的预览共用这一份 ——
 * 出题页右边就是「学生看到的样子」，两边各写一份迟早对不上。
 *
 * 小节标题交给调用方的 `#title` 插槽画：两边的标题样式各在自己的 scoped CSS 里。
 */
const props = defineProps<{
  display: SqlDisplay
  orderSensitive: boolean
}>()

defineSlots<{ title(props: { text: string }): any }>()

const expectedQuery = computed(() =>
  "columns" in props.display.expected ? props.display.expected : null,
)

/** 增删改题：执行后的每张表配上它比原来变了什么 */
const changedTables = computed(() => {
  const expected = props.display.expected
  if (!("changed_tables" in expected)) return []
  return expected.changed_tables.map((table) => ({
    table,
    changes: tableChanges(
      props.display.tables.find((t) => t.name === table.name),
      table,
    ),
  }))
})

const anyChanged = computed(() =>
  changedTables.value.some(
    ({ changes }) => changes && (changes.cells.size > 0 || changes.newRows.size > 0),
  ),
)
</script>

<template>
  <slot name="title" text="数据表" />
  <div v-for="t in display.tables" :key="t.name">
    <p class="sqlTableName">{{ t.name }}</p>
    <SQLDataTable
      :columns="t.columns"
      :rows="t.rows"
      :total-rows="t.total_rows"
      :truncated="t.truncated"
    />
  </div>

  <slot name="title" text="期望结果" />
  <template v-if="expectedQuery">
    <SQLDataTable
      :columns="expectedQuery.columns"
      :rows="expectedQuery.rows"
      :total-rows="expectedQuery.total_rows"
      :truncated="expectedQuery.truncated"
    />
    <p v-if="!orderSensitive" class="sqlNote">结果顺序不限</p>
  </template>
  <div v-for="{ table, changes } in changedTables" :key="table.name">
    <p class="sqlTableName">
      {{ table.dropped ? `${table.name} 表已被删除` : `执行后的 ${table.name} 表` }}
    </p>
    <template v-if="!table.dropped">
      <SQLDataTable
        :columns="table.columns"
        :rows="table.rows"
        :total-rows="table.total_rows"
        :truncated="table.truncated"
        :changes="changes"
      />
      <p v-if="changes?.removed.length" class="sqlNote">
        删掉了 {{ changes.removed.length }} 行（{{ table.columns[0]?.name }} 是
        {{ changes.removed.join("、") }}）
      </p>
      <p v-else-if="changes && !changes.cells.size && !changes.newRows.size" class="sqlNote">
        执行后这张表没有变化
      </p>
    </template>
  </div>
  <p v-if="anyChanged" class="sqlNote legend">
    <span class="swatch" aria-hidden="true"></span>执行后变了的格子
  </p>
</template>

<style scoped>
.sqlTableName {
  font-weight: 600;
  margin: 8px 0 4px;
  font-family: Monaco, Consolas, monospace;
}

.sqlNote {
  font-size: 13px;
  opacity: 0.65;
  margin: 0 0 8px;
}

.legend {
  display: flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 12px;
  height: 12px;
  border: 1px solid #f0d48a;
  background-color: #fff4d6;
}

html.dark .swatch {
  border-color: rgba(240, 180, 40, 0.45);
  background-color: rgba(240, 180, 40, 0.18);
}
</style>
