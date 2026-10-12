<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import AchievementIcon from "shared/components/AchievementIcon.vue"
import type { UserBadge } from "utils/types"
import type { Group } from "../series"
import Medal from "./Medal.vue"
import SeriesRow from "./SeriesRow.vue"

/** 一组成就线（做题 / 坚持 / …），「彩蛋」组末尾是还没找到的问号，「题单和比赛」组末尾是拿到的题单奖章 */
const props = defineProps<{ group: Group; badges?: UserBadge[]; compact?: boolean }>()

const theme = useThemeVars()
const showBadges = computed(() => props.group.name === "题单和比赛" && !!props.badges?.length)
</script>

<template>
  <section class="card" :class="{ compact }">
    <h3>
      {{ group.name }}
      <small>{{ group.got }} / {{ group.total }}</small>
    </h3>
    <SeriesRow v-for="item in group.series" :key="item.metric" :series="item" :compact="compact" />
    <div v-if="group.masked" class="masked">
      <span class="masked-title">还有 {{ group.masked }} 个没找到</span>
      <div class="masked-list">
        <Medal v-for="i in group.masked" :key="i" state="unknown" :size="compact ? 30 : 34" />
      </div>
    </div>
    <div v-if="showBadges" class="badges">
      <span class="masked-title">拿到的题单奖章</span>
      <div class="badge-list">
        <n-tooltip v-for="b in badges" :key="b.id" :delay="150">
          <template #trigger>
            <router-link
              :to="{ name: 'problemset', params: { problemSetId: b.problemSet.id } }"
              class="badge"
            >
              <AchievementIcon :icon="b.badge.icon" :size="32" />
              <span>{{ b.badge.name }}</span>
            </router-link>
          </template>
          {{ b.badge.description }} · 来自题单「{{ b.problemSet.title }}」
        </n-tooltip>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 20px 20px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
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
  color: v-bind("theme.textColor3");
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
  color: v-bind("theme.textColor2");
}

.masked-list,
.badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge {
  width: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 15px;
  text-align: center;
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.badge span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compact {
  padding: 12px 14px 16px;
}
</style>
