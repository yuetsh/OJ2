<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import { RARITY_LABEL } from 'utils/constants'
import { useRarityColor } from 'shared/composables/rarity'
import type { Near } from '../series'
import Medal from './Medal.vue'

/**
 * 「快拿到了」：每个只说还差什么，进度条底下是现在几 / 要几、本班几人有。
 * `wide`：旁边没有「本班」（没有班级的号）时三个横着排，占满整宽
 */
defineProps<{ items: Near[]; compact?: boolean; wide?: boolean }>()

const theme = useThemeVars()
const rarityText = useRarityColor()

function now(item: Near) {
  const { series, achievement } = item
  return series.streak ? `现在连着 ${series.value} ${series.unit}` : `${series.value} / ${achievement.threshold} ${series.unit}`
}

const percent = (item: Near) => Math.round((item.series.value / item.achievement.threshold!) * 100)
</script>

<template>
  <section class="card" :class="{ compact, wide }">
    <h3>快拿到了</h3>
    <div class="list">
      <div v-for="item in items" :key="item.achievement.id" class="item">
        <Medal
          :icon="item.achievement.icon"
          :rarity="item.achievement.rarity"
          :size="compact ? 44 : 48"
          state="off"
          :ring="item.series.value / item.achievement.threshold!"
        />
        <div class="body">
          <div class="head">
            <b>{{ item.achievement.name }}</b>
            <span class="tag" :style="{ color: rarityText[item.achievement.rarity] }">
              {{ RARITY_LABEL[item.achievement.rarity] }}
            </span>
            <span class="remain">{{ item.remain }}</span>
          </div>
          <n-progress
            type="line"
            :percentage="percent(item)"
            :height="6"
            :show-indicator="false"
            :color="theme.primaryColor"
            :border-radius="3"
            :fill-border-radius="3"
          />
          <div class="foot">
            <span>{{ now(item) }}</span>
            <span v-if="item.achievement.classHolders !== null"> 本班 {{ item.achievement.classHolders }} 人有 </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 20px 6px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  background: v-bind('theme.cardColor');
}

h3 {
  margin: 0 0 8px;
  font-size: var(--oj-fs-h2);
}

.item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 0;
  border-top: 1px solid v-bind('theme.dividerColor');
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--oj-fs-body);
}

.tag {
  font-size: 12px;
}

.remain {
  margin-left: auto;
  font-size: var(--oj-fs-sec);
  font-weight: 600;
  color: v-bind('theme.primaryColorPressed');
  white-space: nowrap;
}

.foot {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: v-bind('theme.textColor3');
  font-variant-numeric: tabular-nums;
}

.wide {
  padding-bottom: 14px;
}

.wide .list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 32px;
}

.wide .item {
  border-top: 1px solid v-bind('theme.dividerColor');
}

/* 手机：「还差什么」换到名字下面一行 */
.compact {
  padding: 12px 14px 4px;
}

.compact .head {
  flex-wrap: wrap;
  row-gap: 2px;
}

.compact .remain {
  margin-left: 0;
  flex-basis: 100%;
}
</style>
