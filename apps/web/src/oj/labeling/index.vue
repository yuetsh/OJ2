<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import type { LabelingKind, LabelingListItem } from '@oj2/contract'
import { getLabelings } from 'oj/api'

/** 「数据标注」列表（画布 LabelStudent ①）：一节一张卡片，整张可点；登录了的显示自己做到哪 */
const theme = useThemeVars()
const labelings = ref<LabelingListItem[]>([])
const loading = ref(true)

const KIND_TEXT: Record<LabelingKind, string> = { text: '文字', image: '图片', span: '实体标注', box: '框选' }

onMounted(async () => {
  try {
    labelings.value = await getLabelings()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="oj-page labelingList">
    <h1 class="title">数据标注</h1>
    <n-spin v-if="loading" size="small" />
    <n-empty v-else-if="!labelings.length" description="还没有内容" />
    <div v-else class="cards">
      <router-link v-for="l in labelings" :key="l.id" :to="{ name: 'labeling', params: { labelingID: l.id } }" class="card">
        <div class="meta">
          <n-tag size="small" :bordered="false">{{ KIND_TEXT[l.kind] }}</n-tag>
          <span class="sec">{{ l.itemCount }} 条</span>
          <n-tag v-if="!l.isPublic" size="small" :bordered="false" type="warning">没公开</n-tag>
        </div>
        <b class="name">{{ l.title }}</b>
        <div v-if="l.firstCorrect !== null" class="state">
          <span class="done">已完成</span><span class="sec">一次就对 {{ l.firstCorrect }}/{{ l.itemCount }}</span>
        </div>
        <div v-else-if="l.passedCount" class="state">
          <span class="track"><span class="fill" :style="{ width: `${(l.passedCount / Math.max(1, l.itemCount)) * 100}%` }"></span></span>
          <span class="sec">做到第 {{ l.passedCount + 1 }} 条</span>
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
  flex: 1 1 auto;
  height: 8px;
  border-radius: 4px;
  background: v-bind('theme.dividerColor');
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: v-bind('theme.primaryColor');
}

@media (max-width: 600px) {
  .cards {
    grid-template-columns: 1fr;
  }
}
</style>
