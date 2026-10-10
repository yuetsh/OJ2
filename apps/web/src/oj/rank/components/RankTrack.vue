<script setup lang="ts">
import type { RankRow } from "@oj2/contract"
import { useThemeVars, type DropdownOption } from "naive-ui"
import UserName from "shared/components/UserName.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useRankPalette } from "../palette"
import RankAvatar from "./RankAvatar.vue"

/**
 * 赛道：每人一根条，条越长做对越多，一样长的先做到的排前面（设计稿 G1 / G2）。
 * 桌面两栏，每行 28px（原来挤成 18px 想塞进机房一屏，用户嫌太矮：不必刻意一屏）；
 * 本年级 / 全服只给前面一段 + 我附近一段，
 * 名次断开的地方折起来，点了再把中间那段要回来。
 *
 * 手机（设计稿「手机版」）：窄屏上条只剩几十像素宽，看不出谁多谁少，所以条改成每一行的
 * 底色；默认只列前几行和你附近几行，「看全班 N 人」点开。换范围 / 时间段时父组件换 key
 * 重新挂载，折叠状态跟着复位。
 *
 * 桌面的条只有百来像素（老师那边多一个「⋯」，七十来像素），压不下文字标签：「前一名」
 * 「后一名」靠条的颜色和图例认，「进步最大」改成涨跌那一格的橙底徽章。手机每行有空，标签照旧。
 *
 * 个性签名（设计稿「签名 A」）：桌面一行只有一百来像素的条，放不下一句话，所以有签名的
 * 名字后面挂一个引号，指上去看；手机每行本来就有空，签名直接写在名字后面。
 */
const props = defineProps<{
  rows: RankRow[]
  total: number
  complete: boolean
  /** 名单最多列到第几名（全服 100），折叠处的「第 x–y 名」到此为止 */
  cap?: number | null
  /** 条的满格是几道（第 2 名的数，第 1 名常常一骑绝尘） */
  scale: number
  meId?: number
  chaseId?: number
  threatId?: number
  hotId?: number
  /** 本年级 / 全服里「你们班」的班号，这些人的条浅绿 */
  mateClass?: string | null
  teacher?: boolean
  expanding?: boolean
  /** 手机上只有末尾一段折起来时按钮上的字，比如「看全班 39 人」 */
  wholeLabel?: string
}>()
const emit = defineEmits<{
  open: [username: string]
  expand: []
  submissions: [username: string]
  analysis: [username: string]
  hide: [row: RankRow]
  clearMood: [row: RankRow]
}>()

const theme = useThemeVars()
const palette = useRankPalette()
const { isDesktop } = useBreakpoints()

type Item = { kind: "row"; row: RankRow } | { kind: "gap"; from: number; to: number }

/** 手机默认列几行：领奖台下面的前 5 行，加你上下各 2 行；没有你就列前 10 行 */
const PHONE_HEAD = 5
const PHONE_AROUND = 2
const PHONE_HEAD_NO_ME = 10

const collapsed = ref(true)

const meRank = computed(() => props.rows.find((row) => row.user.id === props.meId)?.rank)

const visible = computed(() => {
  if (isDesktop.value || !collapsed.value) return props.rows
  const mine = meRank.value
  return props.rows.filter((row, index) =>
    mine
      ? index < PHONE_HEAD || Math.abs(row.rank - mine) <= PHONE_AROUND
      : index < PHONE_HEAD_NO_ME,
  )
})

const items = computed<Item[]>(() => {
  const list: Item[] = []
  let last = props.rows[0] ? props.rows[0].rank - 1 : 0
  for (const row of visible.value) {
    if (row.rank > last + 1) list.push({ kind: "gap", from: last + 1, to: row.rank - 1 })
    list.push({ kind: "row", row })
    last = row.rank
  }
  const end = props.complete
    ? (props.rows.at(-1)?.rank ?? last)
    : Math.min(props.total, props.cap ?? props.total)
  if (last < end) list.push({ kind: "gap", from: last + 1, to: end })
  return list
})

/** 手机上只有末尾一段折起来（本班的常见情况），按钮就说「看全班 N 人」 */
function gapText(item: { from: number; to: number }) {
  const gaps = items.value.filter((entry) => entry.kind === "gap")
  if (
    !isDesktop.value &&
    props.wholeLabel &&
    gaps.length === 1 &&
    item.to === props.rows.at(-1)?.rank
  )
    return `${props.wholeLabel} ▾`
  return `第 ${item.from}–${item.to} 名 · ${item.to - item.from + 1} 人 · 展开 ▾`
}

/** 展开：手上的数据够就直接摊开，不够（本年级 / 全服中间那段）再找父组件要全量 */
function expandGap() {
  collapsed.value = false
  if (!props.complete) emit("expand")
}

/** 两栏：前一半、后一半。手机一栏 */
const columns = computed(() => {
  if (!isDesktop.value) return [items.value]
  const half = Math.ceil(items.value.length / 2)
  return [items.value.slice(0, half), items.value.slice(half)]
})

function barColor(row: RankRow) {
  const id = row.user.id
  if (id === props.meId) return palette.value.me
  if (id === props.chaseId) return palette.value.chase
  if (id === props.threatId) return palette.value.threat
  if (props.mateClass && row.className === props.mateClass) return palette.value.mate
  return palette.value.bar
}

/** 手机：条做成整行的底色，颜色淡一档，字压在上面也看得清 */
function fillColor(row: RankRow) {
  const id = row.user.id
  const soft = palette.value.soft
  if (id === props.meId) return soft.me
  if (id === props.chaseId) return soft.chase
  if (id === props.threatId) return soft.threat
  if (props.mateClass && row.className === props.mateClass) return soft.mate
  return soft.bar
}

function ratio(row: RankRow) {
  if (!row.solved) return 0
  return Math.max(1.5, Math.min(100, (row.solved / Math.max(1, props.scale)) * 100))
}

function width(row: RankRow) {
  return `${ratio(row)}%`
}

function menuOf(row: RankRow): DropdownOption[] {
  return [
    { label: "看他的提交", key: "submissions" },
    { label: "看他的智能分析", key: "analysis" },
    ...(row.mood ? [{ label: "清空他的签名…", key: "mood" }] : []),
    { label: "不计入排名…", key: "hide" },
  ]
}

function onMenu(key: string, row: RankRow) {
  if (key === "submissions") emit("submissions", row.user.username)
  else if (key === "analysis") emit("analysis", row.user.username)
  else if (key === "mood") emit("clearMood", row)
  else emit("hide", row)
}
</script>

<template>
  <div class="track" :class="{ single: !isDesktop }">
    <div v-for="(column, index) in columns" :key="index" class="column">
      <template
        v-for="item in column"
        :key="item.kind === 'row' ? item.row.user.id : `gap${item.from}`"
      >
        <button v-if="item.kind === 'gap'" class="gap" :disabled="expanding" @click="expandGap">
          {{ gapText(item) }}
        </button>
        <div
          v-else-if="!isDesktop"
          class="prow"
          :class="{ me: item.row.user.id === meId, zero: !item.row.solved }"
        >
          <span class="fill" :style="{ width: width(item.row), background: fillColor(item.row) }" />
          <span class="rank">{{ item.row.solved ? item.row.rank : "—" }}</span>
          <RankAvatar
            :username="item.row.user.username"
            :avatar="item.row.avatar"
            :size="20"
            :me="item.row.user.id === meId"
          />
          <button class="who" @click="emit('open', item.row.user.username)">
            <UserName :username="item.row.user.username" />
          </button>
          <span class="mood">{{ item.row.mood }}</span>
          <span v-if="item.row.user.id === chaseId" class="tag chase">前一名</span>
          <span v-else-if="item.row.user.id === threatId" class="tag threat">后一名</span>
          <span v-else-if="item.row.user.id === hotId" class="tag hot">进步最大</span>
          <span class="solved">{{ item.row.solved }}</span>
          <span class="change">
            <span v-if="(item.row.change ?? 0) > 0" class="up">↑{{ item.row.change }}</span>
            <span v-else-if="(item.row.change ?? 0) < 0" class="down"
              >↓{{ -item.row.change! }}</span
            >
            <span v-else-if="item.row.change === 0" class="flat">—</span>
          </span>
          <n-dropdown
            v-if="teacher"
            trigger="click"
            :options="menuOf(item.row)"
            @select="(key: string) => onMenu(key, item.row)"
          >
            <button class="more" aria-label="更多">⋯</button>
          </n-dropdown>
        </div>
        <div v-else class="lane" :class="{ me: item.row.user.id === meId, zero: !item.row.solved }">
          <span class="rank">{{ item.row.solved ? item.row.rank : "—" }}</span>
          <RankAvatar
            :username="item.row.user.username"
            :avatar="item.row.avatar"
            :size="20"
            :me="item.row.user.id === meId"
          />
          <n-tooltip :disabled="!item.row.mood" :style="{ maxWidth: '300px' }">
            <template #trigger>
              <button class="who" @click="emit('open', item.row.user.username)">
                <UserName :username="item.row.user.username" />
                <svg
                  v-if="item.row.mood"
                  class="quote"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  role="img"
                  aria-label="有个性签名"
                >
                  <path
                    d="M4 18v-5c0-4 2-7 6-8l1 2c-2 1-3 2.5-3 4h3v7zm9 0v-5c0-4 2-7 6-8l1 2c-2 1-3 2.5-3 4h3v7z"
                  />
                </svg>
              </button>
            </template>
            {{ item.row.mood }}
          </n-tooltip>
          <span class="bar-box" :style="{ background: palette.track }">
            <span class="bar" :style="{ width: width(item.row), background: barColor(item.row) }" />
          </span>
          <span class="solved">{{ item.row.solved }}</span>
          <span class="change">
            <span v-if="item.row.user.id === hotId" class="up hot" title="进步最大"
              >↑{{ item.row.change }}</span
            >
            <span v-else-if="(item.row.change ?? 0) > 0" class="up">↑{{ item.row.change }}</span>
            <span v-else-if="(item.row.change ?? 0) < 0" class="down"
              >↓{{ -item.row.change! }}</span
            >
            <span v-else-if="item.row.change === 0" class="flat">—</span>
          </span>
          <n-dropdown
            v-if="teacher"
            trigger="click"
            :options="menuOf(item.row)"
            @select="(key: string) => onMenu(key, item.row)"
          >
            <button class="more" aria-label="更多">⋯</button>
          </n-dropdown>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.track {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 40px;
  padding: 12px 24px 20px;
}

.track.single {
  grid-template-columns: 1fr;
  padding: 10px 12px 14px;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.lane {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--oj-fs-body);
}

.single .column {
  gap: 3px;
}

.prow {
  position: relative;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 4px;
  border-radius: 6px;
  overflow: hidden;
  font-size: var(--oj-fs-body);
}

.prow > :not(.fill) {
  position: relative;
}

.prow.me {
  box-shadow: inset 0 0 0 1.5px #18a058;
}

.prow.zero {
  opacity: 0.55;
}

.fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 6px;
}

.prow .who {
  width: auto;
  max-width: 120px;
}

/* 手机：签名跟在名字后面，一行放不下就省略 */
.mood {
  flex: 1;
  min-width: 0;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prow .rank {
  width: 24px;
}

.prow .change {
  width: 30px;
}

.single .gap {
  height: 38px;
  margin: 2px 0 0;
  border: 1px dashed v-bind("theme.borderColor");
  border-radius: 6px;
  font-size: var(--oj-fs-sec);
  color: #0c7a43;
}

.lane.me {
  margin: 0 -8px;
  padding: 0 8px;
  border-radius: 6px;
  background: rgba(24, 160, 88, 0.12);
}

.lane.zero {
  opacity: 0.55;
}

.rank {
  width: 28px;
  text-align: right;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.me .rank {
  color: #18a058;
  font-weight: 700;
}

.who {
  width: 126px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.quote {
  flex-shrink: 0;
  color: v-bind("theme.textColor3");
}

.bar-box {
  flex-grow: 1;
  height: 16px;
  position: relative;
  min-width: 40px;
  border-radius: 2px 6px 6px 2px;
}

.bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px 6px 6px 2px;
}

.solved {
  width: 34px;
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.change {
  width: 36px;
  font-size: var(--oj-fs-meta);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.up {
  color: #18a058;
  font-weight: 600;
}

.up.hot {
  color: #ffffff;
  background: #c76a12;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 18px;
  white-space: nowrap;
}

.down {
  color: v-bind("theme.errorColor");
}

.flat {
  color: v-bind("theme.textColor3");
}

.tag {
  font-size: 12px;
  font-weight: 600;
  border-radius: 3px;
  padding: 0 6px;
  line-height: 18px;
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

.tag.hot {
  color: #ffffff;
  background: #c76a12;
}

.more {
  width: 18px;
  padding: 0;
  border: 0;
  background: none;
  color: v-bind("theme.textColor2");
  font-weight: 700;
  cursor: pointer;
}

.gap {
  height: 36px;
  margin: 6px 0;
  border: 0;
  border-top: 1px dashed v-bind("theme.borderColor");
  border-bottom: 1px dashed v-bind("theme.borderColor");
  background: none;
  font: inherit;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.gap:hover {
  color: v-bind("theme.primaryColor");
}
</style>
