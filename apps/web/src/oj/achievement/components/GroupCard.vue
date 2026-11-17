<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import AchievementIcon from 'shared/components/AchievementIcon.vue'
import { RARITY_LABEL } from 'utils/constants'
import { parseTime } from 'utils/functions'
import type { Achievement, UserBadge } from 'utils/types'
import type { Group } from '../series'
import Medal from './Medal.vue'
import SeriesRow from './SeriesRow.vue'

/**
 * 一组成就线（做题 / 坚持 / …），「彩蛋」组末尾是还没找到的问号，「专题和比赛」组末尾是拿到的专题奖章。
 * 「小鲸鱼」组末尾是玩她玩出来的那些（一档的隐藏成就）：拿到的一格格带名字，后面跟着问号
 */
const props = defineProps<{ group: Group; badges?: UserBadge[]; compact?: boolean }>()

const theme = useThemeVars()
const showBadges = computed(() => props.group.name === '专题和比赛' && !!props.badges?.length)
const mascot = computed(() => props.group.name === '小鲸鱼')

function when(item: Achievement) {
  // 补发的不写日期：一次补发会给几百人盖上同一个时间戳
  return item.backfilled || !item.unlockTime ? '已拿到' : `${parseTime(item.unlockTime, 'M月D日')}拿到`
}
</script>

<template>
  <section class="card" :class="{ compact }">
    <h3>
      {{ group.name }}
      <small>{{ group.got }} / {{ group.total }}</small>
    </h3>
    <SeriesRow v-for="item in group.series" :key="item.metric" :series="item" :compact="compact" />
    <div v-if="mascot && (group.found.length || group.masked)" class="masked">
      <span class="masked-title">
        玩出来的
        <template v-if="group.masked">· 还有 {{ group.masked }} 个没找到</template>
      </span>
      <div class="masked-list">
        <n-tooltip v-for="item in group.found" :key="item.id" :delay="150">
          <template #trigger>
            <span class="found">
              <Medal :icon="item.icon" :rarity="item.rarity" :size="compact ? 30 : 34" />
              <span>{{ item.name }}</span>
            </span>
          </template>
          <b>{{ item.name }}</b> · {{ RARITY_LABEL[item.rarity] }}<br />
          {{ item.description }}<br />
          {{ when(item) }} · 全站 {{ item.holders }} 人有
        </n-tooltip>
        <Medal v-for="i in group.masked" :key="`q${i}`" state="unknown" :size="compact ? 30 : 34" />
      </div>
    </div>
    <div v-else-if="group.masked" class="masked">
      <span class="masked-title">还有 {{ group.masked }} 个没找到</span>
      <div class="masked-list">
        <Medal v-for="i in group.masked" :key="i" state="unknown" :size="compact ? 30 : 34" />
      </div>
    </div>
    <div v-if="showBadges" class="badges">
      <span class="masked-title">拿到的专题奖章</span>
      <div class="badge-list">
        <n-tooltip v-for="b in badges" :key="b.id" :delay="150">
          <template #trigger>
            <router-link :to="{ name: 'problemset', params: { problemSetId: b.problemSet.id } }" class="badge">
              <AchievementIcon :icon="b.badge.icon" :size="24" />
              <span>{{ b.badge.name }}</span>
            </router-link>
          </template>
          {{ b.badge.description }} · 来自专题「{{ b.problemSet.title }}」
        </n-tooltip>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 20px 20px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  background: v-bind('theme.cardColor');
}

h3 {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--oj-fs-h2);
}

h3 small {
  font-size: var(--oj-fs-meta);
  font-weight: 400;
  color: v-bind('theme.textColor3');
  font-variant-numeric: tabular-nums;
}

.masked,
.badges {
  margin-top: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.masked-title {
  font-size: 13px;
  color: v-bind('theme.textColor2');
}

.masked-list,
.badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.found {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-right: 10px;
  border-radius: 999px;
  font-size: var(--oj-fs-sec);
  white-space: nowrap;
  background: v-bind('theme.actionColor');
}

/* 奖章名最长 9 个字（「有趣和无趣的观察者」），竖排在格子里放不下，横排写全 */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px 0 6px;
  border-radius: 6px;
  font-size: var(--oj-fs-sec);
  white-space: nowrap;
  color: v-bind('theme.textColor1');
  background: v-bind('theme.actionColor');
  text-decoration: none;
}

.compact {
  padding: 12px 14px 16px;
}
</style>
