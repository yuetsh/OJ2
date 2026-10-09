<script setup lang="ts">
import type { RankRow } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import UserName from "shared/components/UserName.vue"
import { useRankPalette } from "../palette"
import RankAvatar from "./RankAvatar.vue"

/**
 * 领奖台：前三名站在台阶上，第一名戴皇冠。赛道从第 4 名接着排，前三不再出现第二遍。
 * 你要追的人站在台上时台阶描蓝边、挂「你要追的」，和赛道里的蓝条是一回事。
 */
const props = defineProps<{
  rows: RankRow[]
  meId?: number
  chaseId?: number
  threatId?: number
}>()
defineEmits<{ open: [username: string] }>()

const theme = useThemeVars()
const palette = useRankPalette()

/** 台阶从左到右是 2、1、3 */
const steps = computed(() =>
  [2, 1, 3]
    .map((place) => ({ place, row: props.rows[place - 1] }))
    .filter((step): step is { place: number; row: RankRow } => !!step.row),
)

const HEIGHTS: Record<number, number> = { 1: 50, 2: 38, 3: 30 }
</script>

<template>
  <div class="podium">
    <div v-for="{ place, row } in steps" :key="place" class="step" :class="`p${place}`">
      <div class="top">
        <svg
          v-if="place === 1"
          class="crown"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="#f2c94c"
          stroke="#9a6700"
          stroke-width="1.6"
          stroke-linejoin="round"
          role="img"
          aria-label="第一名"
        >
          <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
        </svg>
        <span v-if="row.user.id === chaseId" class="tag chase">你要追的</span>
        <span v-else-if="row.user.id === threatId" class="tag threat">在追你</span>
        <span v-else-if="row.user.id === meId" class="tag me">你</span>
      </div>
      <RankAvatar
        :username="row.user.username"
        :avatar="row.avatar"
        :size="place === 1 ? 34 : 28"
        :me="row.user.id === meId"
      />
      <button class="name" @click="$emit('open', row.user.username)">
        <UserName :username="row.user.username" />
      </button>
      <div
        class="block"
        :style="{
          height: `${HEIGHTS[place]}px`,
          background: palette.medal[place - 1]!.background,
          boxShadow:
            row.user.id === chaseId
              ? `inset 0 0 0 2px ${palette.chase}`
              : row.user.id === meId
                ? `inset 0 0 0 2px ${palette.me}`
                : undefined,
        }"
      >
        <span class="place" :style="{ color: palette.medal[place - 1]!.color }">{{ place }}</span>
        <span class="solved"
          ><b>{{ row.solved }}</b
          ><small>道</small></span
        >
      </div>
    </div>
    <span v-if="!steps.length" class="empty">还没有人做对，现在做对 1 道就是第一名</span>
  </div>
</template>

<style scoped>
.podium {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 6px;
  margin: 0 16px;
  border-bottom: 2px solid v-bind("theme.dividerColor");
  min-height: 60px;
}

.step {
  width: 170px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.top {
  height: 18px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.tag {
  font-size: 11px;
  font-weight: 600;
  border-radius: 3px;
  padding: 0 5px;
  line-height: 16px;
  white-space: nowrap;
}

.tag.chase {
  color: v-bind("palette.chase");
  background: rgba(47, 111, 208, 0.12);
}

.tag.threat {
  color: v-bind("palette.threat");
  background: rgba(199, 106, 18, 0.12);
}

.tag.me {
  color: v-bind("palette.me");
  background: rgba(24, 160, 88, 0.12);
}

.name {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  min-width: 0;
}

.block {
  width: 100%;
  box-sizing: border-box;
  border-radius: 6px 6px 0 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 10px;
  padding-top: 5px;
}

.place {
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
}

.solved {
  font-variant-numeric: tabular-nums;
}

.solved b {
  font-size: 16px;
}

.solved small {
  font-size: 11px;
  color: v-bind("theme.textColor3");
  margin-left: 1px;
}

.empty {
  padding: 18px 0;
  color: v-bind("theme.textColor3");
  font-size: 13px;
}
</style>
