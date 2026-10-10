<script setup lang="ts">
import type { ClassPk } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { classLabel } from "oj/submission/utils"
import { useRankPalette } from "oj/rank/palette"
import { needToTie, pkColor, shortLabels, tint } from "../utils"
import PkRace from "./PkRace.vue"

/**
 * 三个班以上（设计稿「班级 PK」C / 学生 · 三个班 / 手机 · 三个班以上）：题目对照格，一行
 * 一道题、一格一个班，越深做对的人越多，皇冠 = 这道做得最好（一样多都算）。右边谁领先的题多、
 * 一句话（学生：离领先最近的那道；老师：差得最多的那道）、赛跑。
 */
const props = defineProps<{ pk: ClassPk; compact: boolean }>()

const theme = useThemeVars()
const palette = useRankPalette()

const shorts = computed(() => shortLabels(props.pk))
const mineIndex = computed(() =>
  props.pk.classes.findIndex((item) => item.className === props.pk.mine),
)

const rows = computed(() =>
  props.pk.problems.map((problem) => {
    const top = Math.max(...problem.cells.map((cell) => cell?.percent ?? -1))
    const winner = problem.cells.findIndex((cell) => cell?.best)
    const own = mineIndex.value >= 0 ? problem.cells[mineIndex.value] : null
    const tie =
      own && !own.best ? needToTie(own, props.pk.classes[mineIndex.value]!.members, top) : null
    return {
      problem,
      winner,
      tie,
      cells: problem.cells.map((cell, index) => {
        if (!cell) return null
        // 做对比例 45% 以下最浅，100% 最深；深到压白字时字换白
        const alpha = Math.max(0.1, Math.min(0.85, ((cell.percent - 45) / 55) * 0.85))
        return {
          ...cell,
          background: tint(pkColor(index), alpha),
          dark: alpha > 0.5,
          hint: `${props.pk.classes[index]!.className.slice(2)}班：做对 ${cell.solved}/${props.pk.classes[index]!.members} 人、交了 ${cell.submissions} 次、一次就对 ${cell.firstPercent}%`,
        }
      }),
    }
  }),
)

const ranking = computed(() =>
  props.pk.classes
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.lead - a.item.lead || b.item.perCapita - a.item.perCapita),
)

/** 右边那一句：学生看离领先最近的那道，老师看差得最多的那道 */
const insight = computed(() => {
  if (mineIndex.value >= 0) {
    const close = rows.value.filter((row) => row.tie !== null).sort((a, b) => a.tie! - b.tie!)[0]
    if (!close) return { mine: true, text: "同一批题你们班都做得最好" }
    return {
      mine: true,
      text: `离领先最近：「${close.problem.title}」再 ${close.tie} 人做对就和${shorts.value[close.winner]}打平`,
    }
  }
  let worst: { title: string; low: number; lowIndex: number; others: number } | null = null
  for (const row of rows.value) {
    const present = row.cells
      .map((cell, index) => (cell ? { percent: cell.percent, index } : null))
      .filter((cell): cell is { percent: number; index: number } => !!cell)
      .sort((a, b) => a.percent - b.percent)
    const gap = present[1]!.percent - present[0]!.percent
    if (!worst || gap > worst.others - worst.low)
      worst = {
        title: row.problem.title,
        low: present[0]!.percent,
        lowIndex: present[0]!.index,
        others: present[1]!.percent,
      }
  }
  if (!worst || worst.others === worst.low) return null
  return {
    mine: false,
    text: `差得最多的是「${worst.title}」：${shorts.value[worst.lowIndex]}只有 ${worst.low}% 做对，别的班都在 ${worst.others}% 以上`,
  }
})

const SHOW_MOBILE = 8
const expanded = ref(false)
const shownRows = computed(() =>
  props.compact && !expanded.value ? rows.value.slice(0, SHOW_MOBILE) : rows.value,
)
const soloCount = computed(() => props.pk.solo.length)

const tab = ref<"race" | "lead">("race")
const medal = (index: number) => palette.value.medal[index]
</script>

<template>
  <div class="grid-pk" :class="{ compact }">
    <div class="card table">
      <div class="card-title">
        <b>同一批题 · 一格一个班</b>
        <span class="muted">
          格子里是全班做对的人占几成，越深越多<template v-if="!compact">
            · 皇冠 = 这道题做得最好的班（一样多就都算）</template
          >
        </span>
      </div>
      <div class="line heads">
        <span v-if="!compact" class="name muted">至少两个班布置过的 {{ rows.length }} 道</span>
        <span
          v-for="(item, index) in pk.classes"
          :key="item.className"
          class="head"
          :class="{ mine: index === mineIndex }"
          :style="{ background: tint(pkColor(index), 0.1) }"
        >
          <span class="head-name" :style="{ color: pkColor(index) }">
            {{ compact ? shorts[index] : classLabel(item.className) }}
            <span v-if="index === mineIndex" class="mine-tag">{{
              compact ? "你们" : "你们班"
            }}</span>
          </span>
          <span class="head-lead">
            <span v-if="!compact" class="muted">领先</span>
            <b :style="{ color: pkColor(index) }">{{ item.lead }}</b>
            <span class="muted">{{ compact ? "道领先" : "道" }}</span>
          </span>
          <span v-if="!compact" class="muted per">人均做对 {{ item.perCapita }}</span>
        </span>
      </div>
      <div
        v-for="row in shownRows"
        :key="row.problem.problemId"
        class="line"
        :class="{ stacked: compact }"
      >
        <span class="name">
          <span v-if="!compact" class="muted id">#{{ row.problem.displayId }}</span>
          <router-link class="ell" :to="`/problem/${row.problem.displayId}`">{{
            row.problem.title
          }}</router-link>
          <span v-if="row.tie !== null" class="tie" :class="{ close: row.tie <= 2 }"
            >再 {{ row.tie }} 人就平</span
          >
        </span>
        <div class="cells">
          <template v-for="(cell, index) in row.cells" :key="index">
            <span v-if="!cell" class="cell none">{{ compact ? "—" : "没布置" }}</span>
            <span
              v-else
              class="cell"
              :class="{ best: cell.best, dark: cell.dark, mine: index === mineIndex }"
              :style="{ background: cell.background }"
              :title="cell.hint"
            >
              <svg v-if="cell.best" class="crown" viewBox="0 0 24 24" aria-label="这道做得最好">
                <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
              </svg>
              <b>{{ cell.percent }}{{ compact ? "" : "%" }}</b>
              <span v-if="!compact" class="first">一次 {{ cell.firstPercent }}%</span>
            </span>
          </template>
        </div>
      </div>
      <button
        v-if="compact && rows.length > SHOW_MOBILE"
        class="more"
        @click="expanded = !expanded"
      >
        {{ expanded ? "收起" : `再看 ${rows.length - SHOW_MOBILE} 道 ›` }}
      </button>
      <span v-if="!compact && soloCount" class="muted foot">
        只有一个班做过的 {{ soloCount }} 道不在格子里 · 鼠标放到格子上看做对几个人、交了几次
      </span>
    </div>

    <div class="side" :class="{ compact }">
      <div v-if="compact" class="tabs" role="tablist">
        <button :class="{ on: tab === 'race' }" role="tab" @click="tab = 'race'">赛跑</button>
        <button :class="{ on: tab === 'lead' }" role="tab" @click="tab = 'lead'">
          谁领先的题多
        </button>
      </div>
      <div v-if="!compact || tab === 'lead'" class="card pad">
        <div v-if="!compact" class="card-title">
          <b>谁领先的题多</b><span class="muted">同一批题里</span>
        </div>
        <div
          v-for="({ item, index }, place) in ranking"
          :key="item.className"
          class="lead-row"
          :class="{ mine: index === mineIndex }"
        >
          <span
            class="medal"
            :style="
              medal(place)
                ? { color: medal(place)!.color, background: medal(place)!.background }
                : undefined
            "
            >{{ place + 1 }}</span
          >
          <span class="lead-name" :style="{ color: pkColor(index) }">
            {{ classLabel(item.className) }}
            <span v-if="index === mineIndex" class="mine-tag">你们班</span>
          </span>
          <span
            ><b class="num">{{ item.lead }}</b
            ><span class="muted"> 道领先</span></span
          >
        </div>
        <div v-if="insight" class="insight" :class="{ mine: insight.mine }">{{ insight.text }}</div>
      </div>
      <div v-if="!compact || tab === 'race'" class="card pad">
        <div v-if="!compact" class="card-title">
          <b>赛跑</b><span class="muted">这学期累计人均做对</span>
        </div>
        <PkRace :pk="pk" :width="420" :height="compact ? 220 : 230" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-pk {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.grid-pk.compact {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.card {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
  min-width: 0;
}

.table {
  flex: 1.75;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pad {
  padding: 12px 16px;
}

.card-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.muted {
  font-size: 12px;
  font-weight: 400;
  color: v-bind("theme.textColor3");
}

.line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
}

.line.heads {
  align-items: stretch;
}

.name {
  width: 290px;
  flex-shrink: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.heads .name {
  align-items: flex-end;
  padding-bottom: 6px;
}

.name a {
  font-size: 13px;
  font-weight: 600;
  color: v-bind("theme.textColor1");
  text-decoration: none;
  min-width: 0;
}

.name a:hover {
  color: v-bind("theme.primaryColor");
}

.id {
  flex-shrink: 0;
  font-size: 11px;
}

.ell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.head {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0;
  border-radius: 6px;
}

.head.mine {
  box-shadow: inset 0 0 0 2px #9fd8b8;
}

.head-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
}

.head-lead {
  display: flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.per {
  font-size: 11px;
  white-space: nowrap;
}

.head-lead b {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}

.mine-tag {
  font-size: 11px;
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
  border-radius: 3px;
  padding: 0 5px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  font-weight: 600;
  white-space: nowrap;
}

.cells {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 6px;
}

.heads .head,
.cells .cell {
  flex: 1;
}

.cell {
  min-width: 0;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 4px;
  color: v-bind("theme.textColor1");
  font-variant-numeric: tabular-nums;
}

.cell.dark {
  color: #ffffff;
}

.cell.best {
  box-shadow: inset 0 0 0 2px #c58b00;
}

.cell b {
  font-size: 14px;
}

.first {
  font-size: 11px;
  opacity: 0.85;
}

.cell.none {
  font-size: 12px;
  color: v-bind("theme.textColorDisabled");
  background: repeating-linear-gradient(
    135deg,
    v-bind("theme.actionColor") 0 6px,
    v-bind("theme.hoverColor") 6px 12px
  );
}

.crown {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  fill: #c58b00;
  stroke: #c58b00;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.cell.dark .crown {
  fill: #ffffff;
  stroke: #ffffff;
}

.tie {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  color: v-bind("theme.textColor3");
}

.tie.close {
  color: #18a058;
  background: rgba(24, 160, 88, 0.12);
  border-radius: 3px;
  padding: 0 5px;
}

.foot {
  padding-top: 4px;
}

.side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lead-row {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.lead-row.mine {
  background: rgba(24, 160, 88, 0.08);
  border-radius: 6px;
  padding: 0 6px;
  margin: 0 -6px;
}

.medal {
  width: 26px;
  height: 26px;
  border-radius: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
  color: v-bind("theme.textColor2");
}

.lead-name {
  flex: 1;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.num {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.insight {
  margin-top: 8px;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  padding: 8px 10px;
  background: v-bind("theme.actionColor");
  border-radius: 6px;
}

.insight.mine {
  background: transparent;
  border: 1px dashed #9fd8b8;
  color: #18a058;
  font-weight: 600;
}

.more {
  width: 100%;
  height: 40px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.primaryColor");
  cursor: pointer;
}

/* ---------- 手机 ---------- */
.compact .table {
  padding: 10px 12px 2px;
}

.compact .line.heads {
  min-height: 0;
  padding-top: 4px;
}

.compact .head {
  padding: 6px 0;
}

.compact .head-name {
  font-size: 12px;
  flex-direction: column;
  gap: 0;
}

.compact .per {
  font-size: 11px;
  white-space: nowrap;
}

.head-lead b {
  font-size: 20px;
}

.line.stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 6px 0;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.line.stacked .name {
  width: auto;
}

.compact .cells {
  gap: 4px;
}

.compact .cell {
  height: 28px;
  gap: 2px;
  font-size: 12px;
}

.compact .cell b {
  font-size: 12px;
}

.compact .crown {
  width: 10px;
  height: 10px;
}

.side.compact {
  gap: 0;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  padding: 0 12px 12px;
}

.side.compact .card {
  border: 0;
  padding: 10px 0 0;
}

.tabs {
  display: flex;
  gap: 18px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.tabs button {
  height: 34px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.tabs button.on {
  color: #18a058;
  font-weight: 600;
  box-shadow: inset 0 -2px 0 #18a058;
}
</style>
