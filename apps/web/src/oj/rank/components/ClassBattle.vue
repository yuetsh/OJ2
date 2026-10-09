<script setup lang="ts">
import type { ClassBattleItem } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { classLabel } from "oj/submission/utils"
import { useRankPalette } from "../palette"

/**
 * 班级对抗：全服各班这学期人均做对，绿字是这周人均涨了多少。按人均比，因为班级人数从
 * 十来个到五十几个都有。列前 7 个班，自己的班不在里面就补在最后。
 */
const props = defineProps<{ items: ClassBattleItem[]; mine: string | null; teacher?: boolean }>()

const theme = useThemeVars()
const palette = useRankPalette()

const LIMIT = 7

const shown = computed(() => {
  const head = props.items.slice(0, LIMIT)
  const own = props.items.find((item) => item.className === props.mine)
  return own && own.rank > LIMIT ? [...head, own] : head
})

const max = computed(() => Math.max(1, ...props.items.map((item) => item.perCapita)))

const summary = computed(() => {
  const own = props.items.find((item) => item.className === props.mine)
  if (!own) return ""
  const who = props.teacher ? "这个班" : "你们班"
  const faster = props.items.filter((item) => item.weekGain > own.weekGain).length + 1
  const speed = own.weekGain > 0 ? ` · 这周涨得第 ${faster} 快` : ""
  if (own.rank === 1) return `${who}第 1${speed}`
  const prev = props.items[own.rank - 2]!
  const need = Math.floor(prev.perCapita - own.perCapita) + 1
  return `${who}第 ${own.rank} · 每人再做对 ${need} 道就超过${shortLabel(prev.className)}${speed}`
})

/** 同年级的班只说「3 班」，别的年级说全名 */
function shortLabel(className: string) {
  if (props.mine && className.slice(0, 2) === props.mine.slice(0, 2))
    return ` ${className.slice(2)} 班`
  return ` ${classLabel(className)}`
}
</script>

<template>
  <div class="battle">
    <div class="title">
      <b>班级对抗</b><span class="muted">人均做对 · 全服 · 绿字是这周涨的</span>
    </div>
    <div
      v-for="item in shown"
      :key="item.className"
      class="row"
      :class="{ mine: item.className === mine }"
    >
      <span class="rank">{{ item.rank }}</span>
      <span class="name">{{ classLabel(item.className) }}</span>
      <span class="bar-box">
        <span
          class="bar"
          :style="{
            width: `${(item.perCapita / max) * 100}%`,
            background: item.className === mine ? palette.me : palette.bar,
          }"
        />
      </span>
      <span class="value">{{ item.perCapita }}</span>
      <span class="gain">{{ item.weekGain > 0 ? `+${item.weekGain}` : "" }}</span>
    </div>
    <span v-if="!items.length" class="muted">这学期还没有班做对题</span>
    <span v-if="summary" class="summary">{{ summary }}</span>
  </div>
</template>

<style scoped>
.battle {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
}

.title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.muted {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.row {
  height: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.row.mine {
  margin: 0 -8px;
  padding: 0 8px;
  border-radius: 4px;
  background: rgba(24, 160, 88, 0.12);
}

.rank {
  width: 14px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.name {
  width: 86px;
  white-space: nowrap;
}

.mine .name {
  font-weight: 700;
  color: #18a058;
}

.bar-box {
  flex-grow: 1;
  height: 10px;
  position: relative;
}

.bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px 5px 5px 2px;
}

.value {
  width: 32px;
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.gain {
  width: 34px;
  font-size: 11px;
  color: #18a058;
  font-variant-numeric: tabular-nums;
}

.summary {
  margin-top: 6px;
  font-size: 12px;
  color: #18a058;
}
</style>
