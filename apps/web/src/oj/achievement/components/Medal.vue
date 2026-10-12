<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import AchievementIcon from "shared/components/AchievementIcon.vue"
import { RARITY_COLOR } from "utils/constants"
import type { AchievementRarity } from "utils/types"

/**
 * 一枚徽章：拿到的是稀有度色的圈，没拿到的灰掉，还没找到的隐藏成就是虚线问号。
 * `ring` 给了就在外面画一圈进度（「快拿到了」那几个）。
 */
const props = withDefaults(
  defineProps<{
    icon?: string
    rarity?: AchievementRarity
    size?: number
    state?: "on" | "off" | "unknown"
    ring?: number | null
  }>(),
  { icon: "", rarity: "bronze", size: 40, state: "on", ring: null },
)

const theme = useThemeVars()
const color = computed(() => RARITY_COLOR[props.rarity])
const r = computed(() => props.size / 2 + 3)
const box = computed(() => props.size + 8)
const circumference = computed(() => 2 * Math.PI * r.value)
</script>

<template>
  <span class="medal" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg
      v-if="ring !== null && state !== 'unknown'"
      class="arc"
      :width="box"
      :height="box"
      :viewBox="`0 0 ${box} ${box}`"
      aria-hidden="true"
    >
      <circle :cx="box / 2" :cy="box / 2" :r="r" fill="none" class="arc-track" stroke-width="3" />
      <circle
        :cx="box / 2"
        :cy="box / 2"
        :r="r"
        fill="none"
        class="arc-fill"
        stroke-width="3"
        stroke-linecap="round"
        :stroke-dasharray="`${circumference * Math.min(1, ring)} ${circumference}`"
      />
    </svg>
    <span v-if="state === 'unknown'" class="disc unknown" :style="{ fontSize: `${size * 0.42}px` }">
      ?
    </span>
    <span
      v-else
      class="disc"
      :class="state"
      :style="state === 'on' ? { borderColor: color, background: `${color}26` } : undefined"
    >
      <AchievementIcon :icon="icon" :size="Math.round(size * 0.56)" />
    </span>
  </span>
</template>

<style scoped>
.medal {
  position: relative;
  flex-shrink: 0;
  display: block;
}

.arc {
  position: absolute;
  left: -4px;
  top: -4px;
  transform: rotate(-90deg);
}

.arc-track {
  stroke: v-bind("theme.dividerColor");
}

.arc-fill {
  stroke: v-bind("theme.primaryColor");
}

.disc {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.disc.off {
  border-color: v-bind("theme.borderColor");
  background: v-bind("theme.actionColor");
}

.disc.off :deep(svg),
.disc.off :deep(img),
.disc.off :deep(span) {
  filter: grayscale(1);
  opacity: 0.4;
}

.disc.unknown {
  border: 1.5px dashed v-bind("theme.borderColor");
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor3");
  font-weight: 700;
}
</style>
