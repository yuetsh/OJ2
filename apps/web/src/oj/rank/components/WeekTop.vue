<script setup lang="ts">
import type { RankRow } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import UserName from "shared/components/UserName.vue"
import { useRankPalette } from "../palette"
import RankAvatar from "./RankAvatar.vue"

/** 这周本班前 5 名（做对过新题的），每周一清零 */
const props = defineProps<{ rows: RankRow[]; meId?: number; loaded: boolean }>()
defineEmits<{ open: [username: string] }>()

const theme = useThemeVars()
const palette = useRankPalette()

const top = computed(() => props.rows.filter((row) => row.solved > 0).slice(0, 5))
const scale = computed(() => top.value[0]?.solved || 1)
</script>

<template>
  <div class="week-top">
    <div v-for="row in top" :key="row.user.id" class="row" :class="{ me: row.user.id === meId }">
      <span
        class="medal"
        :style="
          row.rank <= 3
            ? {
                color: palette.medal[row.rank - 1]!.color,
                background: palette.medal[row.rank - 1]!.background,
              }
            : undefined
        "
        >{{ row.rank }}</span
      >
      <RankAvatar
        :username="row.user.username"
        :avatar="row.avatar"
        :size="18"
        :me="row.user.id === meId"
      />
      <button class="who" @click="$emit('open', row.user.username)">
        <UserName :username="row.user.username" />
      </button>
      <span class="bar-box">
        <span
          class="bar"
          :style="{
            width: `${(row.solved / scale) * 100}%`,
            background: row.user.id === meId ? palette.me : palette.bar,
          }"
        />
      </span>
      <b class="num">{{ row.solved }}</b>
    </div>
    <span v-if="loaded && !top.length" class="muted"
      >这周还没人做对新题，现在做对 1 道就是第一</span
    >
  </div>
</template>

<style scoped>
.week-top {
  display: flex;
  flex-direction: column;
}

.row {
  height: 26px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.row.me {
  margin: 0 -8px;
  padding: 0 8px;
  border-radius: 4px;
  background: rgba(24, 160, 88, 0.12);
}

.medal {
  width: 22px;
  height: 22px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  color: v-bind("theme.textColor2");
}

.who {
  width: 110px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  display: flex;
  min-width: 0;
}

.bar-box {
  flex-grow: 1;
  height: 9px;
  position: relative;
}

.bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px 5px 5px 2px;
}

.num {
  font-variant-numeric: tabular-nums;
}

.muted {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}
</style>
