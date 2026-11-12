<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import type { LabListItem } from '@oj2/contract'
import { getLabs } from 'oj/api'

/** 「数据分析」列表：一节一行，整行可点；登录了的显示自己做到哪 */
const theme = useThemeVars()
const labs = ref<LabListItem[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    labs.value = await getLabs()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="oj-page labList">
    <h1 class="title">数据分析</h1>
    <n-spin v-if="loading" size="small" />
    <n-empty v-else-if="!labs.length" description="还没有内容" />
    <div v-else class="rows">
      <router-link v-for="lab in labs" :key="lab.id" :to="{ name: 'lab', params: { labID: lab.id } }" class="row">
        <span class="name">{{ lab.title }}</span>
        <n-tag v-if="!lab.isPublic" size="small" :bordered="false">没公开</n-tag>
        <span class="grow"></span>
        <span class="dots" aria-hidden="true">
          <span v-for="i in lab.stepCount" :key="i" class="dot" :class="{ on: i <= lab.passedCount }"></span>
        </span>
        <span class="count">
          <template v-if="lab.passedCount === lab.stepCount && lab.stepCount">全做对了</template>
          <template v-else-if="lab.passedCount">做对 {{ lab.passedCount }} / {{ lab.stepCount }} 步</template>
          <template v-else>{{ lab.stepCount }} 步</template>
        </span>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.title {
  margin: 0 0 var(--oj-gap);
  font-size: var(--oj-fs-title);
}

.rows {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  overflow: hidden;
  background: v-bind('theme.cardColor');
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: var(--oj-row-h-roomy);
  padding: 0 var(--oj-pad-x);
  color: inherit;
  text-decoration: none;
  border-top: 1px solid v-bind('theme.dividerColor');
}

.row:first-child {
  border-top: 0;
}

.row:hover {
  background: v-bind('theme.hoverColor');
}

.name {
  font-size: var(--oj-fs-body);
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grow {
  flex: 1 1 auto;
}

.dots {
  display: flex;
  gap: 4px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background: v-bind('theme.dividerColor');
}

.dot.on {
  background: v-bind('theme.primaryColor');
}

.count {
  font-size: var(--oj-fs-sec);
  color: v-bind('theme.textColor3');
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  min-width: 96px;
  text-align: right;
}

@media (max-width: 600px) {
  .row {
    padding: 0 16px;
  }
  .dots {
    display: none;
  }
  .count {
    min-width: 0;
  }
}
</style>
