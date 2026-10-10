<script setup lang="ts">
import type { ClassPk, ClassPkCell } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { classLabel } from "oj/submission/utils"
import { parseTime } from "utils/functions"
import { needToTie, pkColor, plateau, shortLabels, tint } from "../utils"
import PkHist from "./PkHist.vue"

/**
 * 两个班对决（设计稿「班级 PK」B / 学生 · 两个班 / 手机 · 两个班）：只比两个班都布置过的题，
 * 谁做对的人多谁赢这道 → 大比分；副比分是一次就对。下面一道一行左右两根条，差得最多的在上；
 * 再下面每周人均、全班分布。学生看自己班输掉的题，标「再 N 人做对就打平」。
 */
const props = defineProps<{ pk: ClassPk; compact: boolean }>()

const theme = useThemeVars()

const left = computed(() => props.pk.classes[0]!)
const right = computed(() => props.pk.classes[1]!)
const colors = [pkColor(0), pkColor(1)] as const
const shorts = computed(() => shortLabels(props.pk))
const mineIndex = computed(() =>
  props.pk.classes.findIndex((item) => item.className === props.pk.mine),
)

function nameOf(index: number) {
  return index === mineIndex.value ? "你们班" : shorts.value[index]!
}

type Side = "left" | "right" | "tie"

const rows = computed(() =>
  props.pk.problems
    .map((problem) => {
      const [a, b] = problem.cells as [ClassPkCell, ClassPkCell]
      const winner: Side = a.best && b.best ? "tie" : a.best ? "left" : "right"
      const first: Side =
        a.firstPercent === b.firstPercent
          ? "tie"
          : a.firstPercent > b.firstPercent
            ? "left"
            : "right"
      let tie: number | null = null
      const mine = mineIndex.value
      if (mine >= 0 && winner !== "tie" && winner !== (mine === 0 ? "left" : "right")) {
        const own = mine === 0 ? a : b
        const other = mine === 0 ? b : a
        tie = needToTie(own, props.pk.classes[mine]!.members, other.percent)
      }
      return { problem, a, b, winner, first, gap: Math.abs(a.percent - b.percent), tie }
    })
    .sort((x, y) => y.gap - x.gap || x.problem.problemId - y.problem.problemId),
)

const score = computed(() => {
  const count = (key: "winner" | "first", side: Side) =>
    rows.value.filter((row) => row[key] === side).length
  return {
    left: count("winner", "left"),
    right: count("winner", "right"),
    tie: count("winner", "tie"),
    firstLeft: count("first", "left"),
    firstRight: count("first", "right"),
  }
})

const steadier = computed(() => {
  const { firstLeft, firstRight } = score.value
  if (firstLeft === firstRight) return "两个班一样稳"
  return `${nameOf(firstLeft > firstRight ? 0 : 1)}更稳`
})

/** 只有一个班布置过的题：不比，列几道名字 */
const soloText = computed(() => {
  const { solo } = props.pk
  if (!solo.length) return ""
  const names = solo.slice(0, 2).map((item) => `「${item.title}」`)
  const owners = new Set(solo.map((item) => item.className))
  const who =
    owners.size === 1
      ? `只有${nameOf(props.pk.classes.findIndex((item) => item.className === solo[0]!.className))}做过的`
      : "只有一个班做过的"
  return `${who} ${solo.length} 道不比：${names.join("、")}${solo.length > 2 ? " 等" : ""}`
})

const SHOW_MOBILE = 7
const expanded = ref(false)
const shownRows = computed(() =>
  props.compact && !expanded.value ? rows.value.slice(0, SHOW_MOBILE) : rows.value,
)

/** 每周人均：最近 8 周，两班并排的柱 */
const weeks = computed(() => {
  const from = Math.max(0, props.pk.weeks.length - 8)
  const list = props.pk.weeks.slice(from).map((week, k) => ({
    label: parseTime(week, "M月D日"),
    values: [left.value.weekly[from + k] ?? 0, right.value.weekly[from + k] ?? 0],
  }))
  const max = Math.max(1, ...list.flatMap((week) => week.values))
  return { list, max }
})

const plateaus = computed(() => [
  plateau(left.value.distribution),
  plateau(right.value.distribution),
])

const tab = ref<"weekly" | "dist">("weekly")
</script>

<template>
  <div class="duel" :class="{ compact }">
    <div
      class="score"
      :style="{
        background: `linear-gradient(90deg, ${tint(colors[0], 0.12)} 0%, transparent 38%, transparent 62%, ${tint(colors[1], 0.12)} 100%)`,
      }"
    >
      <div
        v-for="(item, index) in [left, right]"
        :key="item.className"
        class="side"
        :class="{ end: index === 1 }"
      >
        <span class="side-name" :style="{ color: colors[index] }">
          <template v-if="index === mineIndex">
            你们班<small>{{ compact ? shorts[index] : classLabel(item.className) }}</small>
          </template>
          <template v-else>{{ compact ? shorts[index] : classLabel(item.className) }}</template>
        </span>
        <span class="side-sub">
          {{ item.members }} 人 · 人均做对 <b>{{ item.perCapita }}</b>
          <template v-if="!compact && item.firstPercent !== null">
            · 一次就对 {{ item.firstPercent }}%</template
          >
        </span>
      </div>
      <div class="mid">
        <span class="muted">两个班都做过的 {{ rows.length }} 道题 · 谁做对的人多谁赢这道</span>
        <span class="big">
          <b :style="{ color: colors[0] }">{{ score.left }}</b>
          <i>:</i>
          <b :style="{ color: colors[1] }">{{ score.right }}</b>
        </span>
        <span class="mid-sub">
          平 {{ score.tie }} 道 · 比一次就对：
          <b :style="{ color: colors[0] }">{{ score.firstLeft }}</b> :
          <b :style="{ color: colors[1] }">{{ score.firstRight }}</b
          >，{{ steadier }}
        </span>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <b>同一批题</b>
        <span class="muted">
          条 = 全班做对的人占几成<template v-if="!compact">
            · 皇冠 = 这道赢了 · 按两班差距从大到小</template
          >
        </span>
        <div class="spacer" />
        <span v-if="soloText && !compact" class="muted">{{ soloText }}</span>
      </div>

      <template v-if="!compact">
        <div v-for="row in shownRows" :key="row.problem.problemId" class="row">
          <span class="info left">
            <span class="value" :class="{ win: row.winner === 'left' }">
              <svg
                v-if="row.winner === 'left'"
                class="crown"
                viewBox="0 0 24 24"
                aria-label="这道赢了"
              >
                <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
              </svg>
              {{ row.a.percent }}%
            </span>
            <span class="sub">
              {{ row.a.solved }}/{{ left.members }} 人 · 一次就对 {{ row.a.firstPercent }}%
            </span>
          </span>
          <span class="bar-box left">
            <span
              class="bar"
              :style="{
                width: `${row.a.percent}%`,
                background: colors[0],
                opacity: row.winner === 'right' ? 0.45 : 1,
              }"
            />
          </span>
          <span class="title">
            <router-link class="ell" :to="`/problem/${row.problem.displayId}`">{{
              row.problem.title
            }}</router-link>
            <span class="tags">
              <span class="muted">#{{ row.problem.displayId }}</span>
              <span v-if="row.winner === 'tie'" class="muted">平</span>
              <span v-else-if="row === rows[0] && row.gap > 0" class="most">差得最多</span>
              <span v-if="row.tie !== null" class="tie" :class="{ close: row.tie <= 2 }">
                再 {{ row.tie }} 人做对就打平
              </span>
            </span>
          </span>
          <span class="bar-box">
            <span
              class="bar"
              :style="{
                width: `${row.b.percent}%`,
                background: colors[1],
                opacity: row.winner === 'left' ? 0.45 : 1,
              }"
            />
          </span>
          <span class="info">
            <span class="value" :class="{ win: row.winner === 'right' }">
              {{ row.b.percent }}%
              <svg
                v-if="row.winner === 'right'"
                class="crown"
                viewBox="0 0 24 24"
                aria-label="这道赢了"
              >
                <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
              </svg>
            </span>
            <span class="sub">
              {{ row.b.solved }}/{{ right.members }} 人 · 一次就对 {{ row.b.firstPercent }}%
            </span>
          </span>
        </div>
      </template>

      <template v-else>
        <div v-for="row in shownRows" :key="row.problem.problemId" class="m-row">
          <div class="m-title">
            <router-link class="ell" :to="`/problem/${row.problem.displayId}`">{{
              row.problem.title
            }}</router-link>
            <span v-if="row.tie !== null" class="tie" :class="{ close: row.tie <= 2 }"
              >再 {{ row.tie }} 人就平</span
            >
            <span v-else-if="row.winner === 'tie'" class="muted">平</span>
          </div>
          <div v-for="(cell, index) in [row.a, row.b]" :key="index" class="m-line">
            <span class="m-name" :style="{ color: colors[index] }">{{ shorts[index] }}</span>
            <span class="bar-box">
              <span
                class="bar"
                :style="{
                  width: `${cell.percent}%`,
                  background: colors[index],
                  opacity:
                    row.winner !== 'tie' && row.winner !== (index === 0 ? 'left' : 'right')
                      ? 0.45
                      : 1,
                }"
              />
            </span>
            <span class="m-value" :class="{ win: cell.best && row.winner !== 'tie' }"
              >{{ cell.percent }}%</span
            >
            <svg
              v-if="cell.best && row.winner !== 'tie'"
              class="crown"
              viewBox="0 0 24 24"
              aria-label="这道赢了"
            >
              <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
            </svg>
            <span v-else class="crown" />
          </div>
        </div>
        <button v-if="rows.length > SHOW_MOBILE" class="more" @click="expanded = !expanded">
          {{ expanded ? "收起" : `再看 ${rows.length - SHOW_MOBILE} 道 ›` }}
        </button>
      </template>
    </div>

    <div class="bottom" :class="{ compact }">
      <div v-if="compact" class="tabs" role="tablist">
        <button :class="{ on: tab === 'weekly' }" role="tab" @click="tab = 'weekly'">
          每周人均
        </button>
        <button :class="{ on: tab === 'dist' }" role="tab" @click="tab = 'dist'">全班分布</button>
      </div>
      <div v-if="!compact || tab === 'weekly'" class="card pad">
        <div v-if="!compact" class="card-title">
          <b>每周人均新做对</b><span class="muted">这学期，最近 {{ weeks.list.length }} 周</span>
        </div>
        <div class="weeks">
          <div v-for="week in weeks.list" :key="week.label" class="week">
            <div class="pair">
              <div v-for="(value, index) in week.values" :key="index" class="bar-col">
                <span class="v" :style="{ color: colors[index] }">{{ value }}</span>
                <span
                  class="wbar"
                  :style="{
                    height: `${Math.max(2, (value / weeks.max) * (compact ? 80 : 110))}px`,
                    background: colors[index],
                  }"
                />
              </div>
            </div>
            <span class="axis">{{ week.label }}</span>
          </div>
        </div>
      </div>
      <div v-if="!compact || tab === 'dist'" class="card pad dist">
        <div v-if="!compact" class="card-title">
          <b>全班分布</b><span class="muted">一根柱一档，横轴是做对几道 · 虚线是中间那位</span>
        </div>
        <div v-for="(item, index) in [left, right]" :key="item.className" class="dist-one">
          <span class="dist-name" :style="{ color: colors[index] }">
            {{ index === mineIndex ? "你们班" : classLabel(item.className) }} · 中间那位
            {{ item.median }} 道
            <template v-if="plateaus[index]">
              · {{ plateaus[index]!.count }} 个人停在 {{ plateaus[index]!.solved }} 道</template
            >
          </span>
          <PkHist :values="item.distribution" :median="item.median" :color="colors[index]" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.duel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.score {
  padding: 18px 28px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 24px;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 4px;
  grid-row: 1;
  grid-column: 1;
}

.side.end {
  grid-column: 3;
  align-items: flex-end;
  text-align: right;
}

.side-name {
  font-size: 22px;
  font-weight: 800;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.side-name small {
  font-size: 14px;
  font-weight: 600;
  color: v-bind("theme.textColor3");
}

.side-sub {
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.side-sub b {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.mid {
  grid-row: 1;
  grid-column: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  text-align: center;
}

.big {
  display: flex;
  align-items: center;
  gap: 18px;
  line-height: 1.05;
}

.big b {
  font-size: 52px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.big i {
  font-style: normal;
  font-size: 28px;
  font-weight: 700;
  color: v-bind("theme.textColor3");
}

.mid-sub {
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.muted {
  font-size: 12px;
  font-weight: 400;
  color: v-bind("theme.textColor3");
}

.card {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
  padding: 12px 16px 4px;
  min-width: 0;
}

.card.pad {
  padding: 12px 16px;
}

.card-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.card-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.spacer {
  flex-grow: 1;
}

.row {
  min-height: 44px;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr) 210px minmax(0, 1fr) 168px;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.row:last-child {
  border-bottom: 0;
}

.info {
  display: flex;
  flex-direction: column;
}

.info.left {
  align-items: flex-end;
}

.value {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: v-bind("theme.textColor3");
}

.value.win {
  color: v-bind("theme.textColor1");
}

.sub {
  font-size: 11px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.crown {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  fill: #c58b00;
  stroke: #c58b00;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.bar-box {
  height: 16px;
  display: flex;
  background: v-bind("theme.actionColor");
  border-radius: 3px;
  overflow: hidden;
}

.bar-box.left {
  justify-content: flex-end;
}

.bar {
  height: 100%;
}

.title {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 0;
}

.title a,
.m-title a {
  max-width: 100%;
  font-size: 13px;
  font-weight: 600;
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.title a:hover,
.m-title a:hover {
  color: v-bind("theme.primaryColor");
}

.ell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tags {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.tags .muted {
  font-size: 11px;
}

.most {
  font-size: 11px;
  font-weight: 600;
  color: #b54708;
}

.tie {
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

.bottom {
  display: flex;
  gap: 16px;
}

.bottom > .card {
  flex: 1;
}

.weeks {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.week {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.pair {
  height: 130px;
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

.bar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.v {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.wbar {
  width: 18px;
  border-radius: 3px 3px 0 0;
}

.axis {
  font-size: 11px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}

.dist {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dist-one {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dist-name {
  font-size: 12px;
  font-weight: 600;
}

/* ---------- 手机 ---------- */
.compact .score {
  padding: 12px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}

.compact .side {
  grid-row: 1;
}

.compact .side.end {
  grid-column: 2;
}

.compact .side-name {
  font-size: 15px;
}

.compact .side-sub {
  font-size: 12px;
}

.compact .mid {
  grid-row: 2;
  grid-column: 1 / 3;
}

.compact .big b {
  font-size: 44px;
}

.compact .mid-sub {
  font-size: 12px;
}

.compact .card {
  padding: 10px 12px 2px;
}

.m-row {
  padding: 8px 0;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.m-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.m-title a {
  flex: 1;
  min-width: 0;
}

.m-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.m-line .bar-box {
  flex: 1;
  height: 12px;
}

.m-name {
  width: 36px;
  font-size: 12px;
  font-weight: 600;
}

.m-value {
  width: 40px;
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.m-value.win {
  font-weight: 700;
}

.m-line .crown {
  width: 14px;
  height: 14px;
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

.bottom.compact {
  flex-direction: column;
  gap: 0;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  padding: 0 12px 12px;
}

.bottom.compact > .card {
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

.compact .pair {
  height: 100px;
  gap: 2px;
}

.compact .wbar {
  width: 12px;
}

.compact .axis {
  font-size: 10px;
}
</style>
