<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { useTone } from "oj/submission/composables/tone"
import { parseTime } from "utils/functions"
import type { ProblemSet } from "utils/types"
import { badgeCondition, badgeShortfall, ladder, nextBadge } from "../badges"

/**
 * 奖章阶梯（设计稿「题单重设计」详情 B）：一排奖章连成一条线，拿到的亮、写哪天拿的；
 * 下一个要拿的套金圈、写「再做对 n 道」；更远的灰着、写条件。
 */
const props = defineProps<{ set: ProblemSet }>()
const theme = useThemeVars()
const tone = useTone()

const steps = computed(() => {
  const next = nextBadge(props.set)?.badge.id
  return ladder(props.set).map((badge) => ({
    badge,
    next: badge.id === next,
    sub: badge.isEarned
      ? badge.earnedTime
        ? parseTime(badge.earnedTime, "M月D日")
        : "拿到了"
      : badge.id === next && props.set.userProgress.isJoined
        ? `再做对 ${badgeShortfall(badge, props.set)} 道`
        : badgeCondition(badge),
  }))
})

/** 连线亮到最后一枚拿到的奖章那里 */
const filled = computed(() => {
  const last = steps.value.map((step) => step.badge.isEarned).lastIndexOf(true)
  return steps.value.length > 1 && last > 0 ? last / (steps.value.length - 1) : 0
})

const warning = computed(() => tone("warning"))
</script>

<template>
  <div class="ladder" :style="{ width: `${steps.length * 92}px` }">
    <div v-if="steps.length > 1" class="track">
      <div class="track-fill" :style="{ width: `${filled * 100}%` }"></div>
    </div>
    <div
      v-for="step in steps"
      :key="step.badge.id"
      class="step"
      :title="`${step.badge.name} · ${badgeCondition(step.badge)}${step.badge.description ? `\n${step.badge.description}` : ''}`"
    >
      <span class="medal" :class="{ next: step.next }">
        <img
          :src="step.badge.icon"
          :alt="step.badge.name"
          :class="{ locked: !step.badge.isEarned }"
        />
      </span>
      <b class="name" :class="{ dim: !step.badge.isEarned }">{{ step.badge.name }}</b>
      <span class="sub" :class="{ urge: step.next && !step.badge.isEarned }">{{ step.sub }}</span>
    </div>
  </div>
</template>

<style scoped>
.ladder {
  position: relative;
  display: flex;
  flex-shrink: 0;
}

.track {
  position: absolute;
  left: 46px;
  right: 46px;
  top: 21px;
  height: 3px;
  background: v-bind("theme.dividerColor");
}

.track-fill {
  height: 100%;
  background: v-bind("theme.successColor");
}

.step {
  position: relative;
  width: 92px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.medal {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: v-bind("theme.cardColor");
  display: flex;
  align-items: center;
  justify-content: center;
}

.medal.next {
  box-shadow: 0 0 0 2px #f0b44c;
}

.medal img {
  width: 36px;
  height: 36px;
}

.locked {
  filter: grayscale(1);
  opacity: 0.35;
}

.name {
  max-width: 88px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.name.dim {
  color: v-bind("theme.textColor3");
  font-weight: 400;
}

.sub {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}

.sub.urge {
  color: v-bind("warning.color");
  font-weight: 600;
}
</style>
