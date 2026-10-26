<script setup lang="ts">
import type { ProfileOverview } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import AchievementIcon from 'shared/components/AchievementIcon.vue'
import { RARITY_COLOR } from 'utils/constants'
import { parseTime } from 'utils/functions'

/** 拿到的成就一个一个摆出来，新的在前；全部 41 个（含没拿到的）在成就页 */
const props = defineProps<{
  achievements: ProfileOverview['achievements']
  username: string
  /** 看的是别人：「全部成就」带上他的名字 */
  other: boolean
  compact?: boolean
}>()

const theme = useThemeVars()
const allLink = computed(() => ({
  path: '/achievement',
  query: props.other ? { name: props.username } : {},
}))
</script>

<template>
  <section class="card" :class="{ compact }">
    <h3>
      成就 <small>{{ achievements.unlocked.length }} / {{ achievements.total }}</small>
      <span class="grow"></span>
      <router-link :to="allLink" class="link">全部成就 ›</router-link>
    </h3>
    <div v-if="achievements.unlocked.length" class="grid">
      <n-tooltip v-for="item in achievements.unlocked" :key="item.id" :delay="200">
        <template #trigger>
          <span class="medal">
            <span class="ring" :style="{ '--rarity': RARITY_COLOR[item.rarity] }">
              <AchievementIcon :icon="item.icon" :size="26" />
            </span>
            <span class="name">{{ item.name }}</span>
          </span>
        </template>
        {{ item.description }} · {{ parseTime(item.unlockTime, 'YYYY年M月D日') }}
      </n-tooltip>
    </div>
    <div v-else class="empty">还没有成就</div>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 18px 16px;
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
  font-size: var(--oj-fs-sec);
  font-weight: 400;
  color: v-bind('theme.textColor3');
}

.grow {
  flex: 1;
}

.link {
  font-size: var(--oj-fs-meta);
  font-weight: 400;
  color: #18a058;
  text-decoration: none;
}

.grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  row-gap: 14px;
  margin-top: 12px;
}

.medal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: default;
}

.ring {
  width: 40px;
  height: 40px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2px solid var(--rarity);
  display: flex;
  align-items: center;
  justify-content: center;
}

.name {
  max-width: 100%;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty {
  padding: 16px 0 4px;
  font-size: var(--oj-fs-sec);
  color: v-bind('theme.textColor3');
}

.compact {
  padding: 4px 0 0;
  border: 0;
  border-radius: 0;
  background: none;
}

.compact .grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
</style>
