<script setup lang="ts">
import type { RankRow, WeeklyChampion } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import UserName from "shared/components/UserName.vue"
import { parseTime } from "utils/functions"
import RankAvatar from "./RankAvatar.vue"

/** 本班最近几周的每周冠军，底下再挂这张榜上「进步最大」的那个人 */
defineProps<{
  champions: WeeklyChampion[]
  hot: RankRow | null
  /** 「这周升了」还是「今天升了」：这周的榜比的是今天早上 */
  since: string
  meId?: number
}>()
defineEmits<{ open: [username: string] }>()

const theme = useThemeVars()

function weekLabel(start: string) {
  return `${parseTime(start, "M月D日")}那周`
}
</script>

<template>
  <div class="champions">
    <div v-for="champion in champions" :key="champion.weekStart" class="row">
      <span class="muted week">{{ weekLabel(champion.weekStart) }}</span>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="#f2c94c"
        stroke="#9a6700"
        stroke-width="1.6"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
      </svg>
      <RankAvatar
        :username="champion.user.username"
        :avatar="champion.avatar"
        :size="20"
        :me="champion.user.id === meId"
      />
      <button class="who" @click="$emit('open', champion.user.username)">
        <UserName :username="champion.user.username" />
      </button>
      <span class="muted num">{{ champion.solved }} 道</span>
    </div>
    <span v-if="!champions.length" class="muted">最近几周还没有冠军</span>
    <div v-if="hot" class="row hot-line">
      <span class="hot-tag">进步最大</span>
      <RankAvatar
        :username="hot.user.username"
        :avatar="hot.avatar"
        :size="20"
        :me="hot.user.id === meId"
      />
      <button class="who" @click="$emit('open', hot.user.username)">
        <UserName :username="hot.user.username" />
      </button>
      <span class="muted">{{ since }}升了 {{ hot.change }} 名</span>
    </div>
  </div>
</template>

<style scoped>
.champions {
  display: flex;
  flex-direction: column;
}

.row {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--oj-fs-sec);
}

.muted {
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
}

.week {
  width: 86px;
  flex-shrink: 0;
}

.who {
  flex-grow: 1;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  display: flex;
  min-width: 0;
}

.num {
  font-variant-numeric: tabular-nums;
}

.hot-line {
  margin-top: 4px;
  padding-top: 8px;
  height: auto;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.hot-tag {
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
  background: #c76a12;
  border-radius: 3px;
  padding: 0 6px;
  line-height: 18px;
  white-space: nowrap;
}
</style>
