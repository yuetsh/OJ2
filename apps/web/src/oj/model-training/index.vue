<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import type { ModelTrainingListItem } from '@oj2/contract'
import { getModelTrainings } from 'oj/api'

/** 「训练模型」列表：一节一张卡片，整张可点；登录了的显示自己的最高分、达标了没有 */
const theme = useThemeVars()
const lessons = ref<ModelTrainingListItem[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    lessons.value = await getModelTrainings()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="oj-page trainingList">
    <h1 class="title">训练模型</h1>
    <n-spin v-if="loading" size="small" />
    <n-empty v-else-if="!lessons.length" description="还没有内容" />
    <div v-else class="cards">
      <router-link v-for="l in lessons" :key="l.id" :to="{ name: 'model training', params: { modelTrainingID: l.id } }" class="card">
        <div class="meta">
          <span class="sec">达标线 {{ l.threshold }}%</span>
          <n-tag v-if="!l.isPublic" size="small" :bordered="false" type="warning">没公开</n-tag>
        </div>
        <b class="name">{{ l.title }}</b>
        <div v-if="l.passed" class="state">
          <span class="done">达标了</span><span class="sec">最高 {{ l.best }}%</span>
        </div>
        <div v-else-if="l.best !== null" class="state">
          <span class="track"><span class="fill" :style="{ width: `${l.best}%` }"></span><span class="line" :style="{ left: `${l.threshold}%` }"></span></span>
          <span class="sec">最高 {{ l.best }}%</span>
        </div>
        <div v-else class="state sec">还没开始</div>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.title {
  margin: 0 0 var(--oj-gap);
  font-size: var(--oj-fs-title);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  background: v-bind('theme.cardColor');
  color: inherit;
  text-decoration: none;
}

.card:hover {
  border-color: v-bind('theme.primaryColorHover');
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name {
  font-size: 17px;
  line-height: 1.5;
}

.state {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--oj-fs-sec);
}

.sec {
  color: v-bind('theme.textColor3');
  font-size: var(--oj-fs-sec);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.done {
  color: v-bind('theme.primaryColor');
  font-weight: 600;
}

.track {
  position: relative;
  flex: 1 1 auto;
  height: 8px;
  border-radius: 4px;
  background: v-bind('theme.dividerColor');
}

.fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: #f0a020;
}

.line {
  position: absolute;
  top: -3px;
  width: 2px;
  height: 14px;
  background: v-bind('theme.textColor2');
}

@media (max-width: 600px) {
  .cards {
    grid-template-columns: 1fr;
  }
}
</style>
