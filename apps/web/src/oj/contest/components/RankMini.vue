<script setup lang="ts">
import type { ContestScoreRow } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { useTone } from "oj/submission/composables/tone"
import { secondsToDuration } from "utils/functions"
import UserName from "./UserName.vue"

/**
 * 题目页右边的小榜：前三名，然后是我和我前后各两个人（中间隔一个「⋯」）。
 * 我在前八里、或者没上榜（老师、还没交题），就直接列前八
 */
const props = defineProps<{ rows: ContestScoreRow[]; me?: number }>()

const theme = useThemeVars()
const tone = useTone()
const success = computed(() => tone("success"))
const danger = computed(() => tone("error"))

const shown = computed(() => {
  const rows = props.rows
  const index = rows.findIndex((row) => row.userId === props.me)
  if (index < 8) return { head: rows.slice(0, 8), tail: [] }
  return { head: rows.slice(0, 3), tail: rows.slice(index - 2, index + 3) }
})

function move(row: ContestScoreRow) {
  return row.rank && row.prevRank ? row.prevRank - row.rank : 0
}
</script>

<template>
  <div class="mini">
    <template v-for="(group, gi) in [shown.head, shown.tail]" :key="gi">
      <div v-if="gi === 1 && group.length" class="gap">⋯</div>
      <div v-for="row in group" :key="row.userId" class="line" :class="{ me: row.userId === me }">
        <span class="rank">{{ row.rank }}</span>
        <span class="move">
          <template v-if="move(row) > 0"
            ><span class="up">↑{{ move(row) }}</span></template
          >
          <template v-else-if="move(row) < 0"
            ><span class="down">↓{{ -move(row) }}</span></template
          >
        </span>
        <UserName
          class="who"
          :username="row.username"
          :class-name="row.className"
          :strong="row.userId === me"
        />
        <span class="solved">{{ row.solved }} 道</span>
        <span class="time">{{ secondsToDuration(row.totalTime) }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mini {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.line {
  height: 30px;
  box-sizing: border-box;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 4px;
  background: v-bind("theme.cardColor");
}

.line.me {
  background: v-bind("success.background");
}

.rank {
  width: 24px;
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: v-bind("theme.textColor2");
}

.me .rank {
  color: v-bind("success.color");
}

.move {
  width: 28px;
  font-size: 11px;
}

.up {
  color: v-bind("success.color");
}

.down {
  color: v-bind("danger.color");
}

.who {
  flex-grow: 1;
  min-width: 0;
}

.solved {
  width: 44px;
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.time {
  width: 62px;
  text-align: right;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.gap {
  height: 14px;
  padding-left: 44px;
  font-size: 12px;
  line-height: 8px;
  color: v-bind("theme.textColor3");
}
</style>
