<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { RARITY_LABEL } from "utils/constants"
import { parseTime } from "utils/functions"
import type { Achievement } from "utils/types"
import type { Series } from "../series"
import Medal from "./Medal.vue"

/**
 * 一条成就线：左边线名和现在的数，右边几档按门槛排在一根进度线上，下一档头上标「差几」。
 * 档位等距摆，不按门槛比例（1 / 10 / 50 / 100 / 200 按比例画，前两档会挤成一个点），
 * 进度在相邻两档之间按比例插值。手机上线名挪到上面，线占满一行。
 */
const props = defineProps<{ series: Series; compact?: boolean }>()

const theme = useThemeVars()
// 「差几」的底色：主色压淡，明暗主题都跟着走
const gapBg = computed(() => `${theme.value.primaryColor}22`)
const size = computed(() => (props.compact ? 34 : 40))
// 少于三档也按三格排，一档、两档的线不会被拉得很长
const cols = computed(() => Math.max(props.series.items.length, 3))
const center = (i: number) => ((i + 0.5) / cols.value) * 100

const fill = computed(() => {
  const { items, value } = props.series
  // 连续几周给的是「现在连着几」，断过的人可能比已经拿到的那档还小 —— 线至少画到拿到的最后一档
  let lastOn = -1
  items.forEach((item, i) => {
    if (item.unlocked) lastOn = i
  })
  return Math.max(lastOn < 0 ? 0 : center(lastOn), reach(items, value))
})

function reach(items: Achievement[], value: number) {
  let prevT = 0
  let prevX = 0
  for (const [i, item] of items.entries()) {
    const t = item.threshold ?? 0
    const x = center(i)
    if (value < t) return prevX + ((value - prevT) / (t - prevT)) * (x - prevX)
    prevT = t
    prevX = x
  }
  return prevX
}

function gap(item: Achievement) {
  if (item !== props.series.next || props.series.value <= 0) return null
  const r = (item.threshold ?? 0) - props.series.value
  return r > 0 ? r : null
}

function when(item: Achievement) {
  if (!item.unlocked) return `现在 ${props.series.value} ${props.series.unit}`
  // 补发的不写日期：一次补发会给几百人盖上同一个时间戳
  if (item.backfilled || !item.unlockTime) return "已拿到"
  return `${parseTime(item.unlockTime, "M月D日")}拿到`
}

function holders(item: Achievement) {
  const site = `全站 ${item.holders} 人有`
  return item.classHolders === null ? site : `本班 ${item.classHolders} 人有 · ${site}`
}
</script>

<template>
  <div class="row" :class="{ compact }">
    <div class="label">
      <span class="name">{{ series.label }}</span>
      <span class="value">
        <b>{{ series.streak ? "现在 " : "" }}{{ series.value }}</b>
        <small>{{ series.unit }}</small>
      </span>
    </div>
    <div class="track" :style="{ height: `${size + 36}px` }">
      <span
        class="line"
        :style="{ top: `${size / 2 - 2}px`, width: `${center(series.items.length - 1)}%` }"
      ></span>
      <span class="line done" :style="{ top: `${size / 2 - 2}px`, width: `${fill}%` }"></span>
      <div
        v-for="(item, i) in series.items"
        :key="item.id"
        class="tier"
        :class="{ on: item.unlocked }"
        :style="{ left: `${center(i)}%` }"
      >
        <n-tooltip :delay="150">
          <template #trigger>
            <span class="trigger">
              <span v-if="gap(item)" class="gap" :style="{ bottom: `${size + 4}px` }">
                差 {{ gap(item) }}
              </span>
              <Medal
                :icon="item.icon"
                :rarity="item.rarity"
                :size="size"
                :state="item.unlocked ? 'on' : 'off'"
              />
            </span>
          </template>
          <div class="tip">
            <b>{{ item.name }}</b> · {{ RARITY_LABEL[item.rarity] }}<br />
            {{ item.description }}<br />
            {{ when(item) }} · {{ holders(item) }}
          </div>
        </n-tooltip>
        <span class="tier-name">{{ item.name }}</span>
        <span class="tier-at">{{ item.threshold }} {{ series.unit }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 118px minmax(0, 1fr);
  align-items: start;
  margin-top: 30px;
}

.label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-right: 12px;
}

.name {
  font-size: 13px;
  color: v-bind("theme.textColor2");
  white-space: nowrap;
}

.value b {
  font-size: 18px;
  line-height: 22px;
  font-variant-numeric: tabular-nums;
}

.value small {
  margin-left: 3px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.track {
  position: relative;
}

.line {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 2px;
  background: v-bind("theme.dividerColor");
}

.line.done {
  background: v-bind("theme.primaryColor");
}

.tier {
  position: absolute;
  top: 0;
  width: 92px;
  margin-left: -46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.trigger {
  position: relative;
  display: block;
  cursor: default;
}

.gap {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  white-space: nowrap;
  color: v-bind("theme.primaryColorPressed");
  background: v-bind(gapBg);
}

.tier-name {
  font-size: 12px;
  line-height: 15px;
  text-align: center;
  white-space: nowrap;
  color: v-bind("theme.textColor3");
}

.tier.on .tier-name {
  color: v-bind("theme.textColor1");
  font-weight: 600;
}

.tier-at {
  font-size: 11px;
  line-height: 14px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.tip {
  max-width: 240px;
  line-height: 20px;
}

/* 手机：线名挪到上面，线占满一行 */
.compact {
  grid-template-columns: minmax(0, 1fr);
  margin-top: 18px;
}

.compact .label {
  flex-direction: row;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 24px;
}

.compact .value b {
  font-size: 16px;
}

.compact .tier {
  width: 72px;
  margin-left: -36px;
}

.compact .tier-name {
  font-size: 11px;
}
</style>
