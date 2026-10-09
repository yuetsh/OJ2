<script setup lang="ts">
import type { RankRow } from "@oj2/contract"
import { useThemeVars, type DropdownOption } from "naive-ui"
import UserName from "shared/components/UserName.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useRankPalette } from "../palette"
import RankAvatar from "./RankAvatar.vue"

/**
 * 赛道：每人一根条，条越长做对越多，一样长的先做到的排前面（设计稿 G1 / G2）。
 * 桌面两栏，机房 1366×768 一屏放得下一个班；本年级 / 全服只给前面一段 + 我附近一段，
 * 名次断开的地方折起来，点了再把中间那段要回来。
 */
const props = defineProps<{
  rows: RankRow[]
  total: number
  complete: boolean
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
}>()
const emit = defineEmits<{
  open: [username: string]
  expand: []
  submissions: [username: string]
  hide: [row: RankRow]
}>()

const theme = useThemeVars()
const palette = useRankPalette()
const { isDesktop } = useBreakpoints()

type Item =
  | { kind: "row"; row: RankRow }
  | { kind: "gap"; from: number; to: number; tail?: boolean; mine?: boolean }

const items = computed<Item[]>(() => {
  const list: Item[] = []
  let last = props.rows[0] ? props.rows[0].rank - 1 : 0
  for (const row of props.rows) {
    if (row.rank > last + 1) list.push({ kind: "gap", from: last + 1, to: row.rank - 1 })
    list.push({ kind: "row", row })
    last = row.rank
  }
  if (!props.complete && last < props.total)
    list.push({ kind: "gap", from: last + 1, to: props.total, tail: true })
  return list
})

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

function width(row: RankRow) {
  if (!row.solved) return "0"
  return `${Math.max(1.5, Math.min(100, (row.solved / Math.max(1, props.scale)) * 100))}%`
}

const menu: DropdownOption[] = [
  { label: "看他的提交", key: "submissions" },
  { label: "不计入排名…", key: "hide" },
]

function onMenu(key: string, row: RankRow) {
  if (key === "submissions") emit("submissions", row.user.username)
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
        <button
          v-if="item.kind === 'gap'"
          class="gap"
          :disabled="expanding"
          @click="emit('expand')"
        >
          第 {{ item.from }}–{{ item.to }} 名 · {{ item.to - item.from + 1 }} 人 · 展开 ▾
        </button>
        <div v-else class="lane" :class="{ me: item.row.user.id === meId, zero: !item.row.solved }">
          <span class="rank">{{ item.row.solved ? item.row.rank : "—" }}</span>
          <RankAvatar
            :username="item.row.user.username"
            :avatar="item.row.avatar"
            :size="16"
            :me="item.row.user.id === meId"
          />
          <button class="who" @click="emit('open', item.row.user.username)">
            <UserName :username="item.row.user.username" />
          </button>
          <span class="bar-box">
            <span class="bar" :style="{ width: width(item.row), background: barColor(item.row) }" />
          </span>
          <span class="solved">{{ item.row.solved }}</span>
          <span class="change">
            <span v-if="(item.row.change ?? 0) > 0" class="up">↑{{ item.row.change }}</span>
            <span v-else-if="(item.row.change ?? 0) < 0" class="down"
              >↓{{ -item.row.change! }}</span
            >
            <span v-else-if="item.row.change === 0" class="flat">—</span>
          </span>
          <span class="tag-box">
            <span v-if="item.row.user.id === chaseId" class="tag chase">要追</span>
            <span v-else-if="item.row.user.id === threatId" class="tag threat">追你</span>
            <span v-else-if="item.row.user.id === hotId" class="tag hot">冲得最猛</span>
          </span>
          <n-dropdown
            v-if="teacher"
            trigger="click"
            :options="menu"
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
  gap: 0 36px;
  padding: 10px 24px 14px;
}

.track.single {
  grid-template-columns: 1fr;
  padding: 10px 12px 14px;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.lane {
  height: 18px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
}

.single .lane {
  height: 26px;
}

.single .who {
  width: 96px;
}

.single .tag-box {
  width: auto;
}

.lane.me {
  margin: 0 -8px;
  padding: 0 8px;
  height: 20px;
  border-radius: 4px;
  background: rgba(24, 160, 88, 0.12);
}

.lane.zero {
  opacity: 0.55;
}

.rank {
  width: 28px;
  text-align: right;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.me .rank {
  color: #18a058;
  font-weight: 700;
}

.who {
  width: 108px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  min-width: 0;
}

.bar-box {
  flex-grow: 1;
  height: 11px;
  position: relative;
  min-width: 40px;
}

.bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px 6px 6px 2px;
}

.solved {
  width: 26px;
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.change {
  width: 34px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.up {
  color: #18a058;
  font-weight: 600;
}

.down {
  color: v-bind("theme.errorColor");
}

.flat {
  color: v-bind("theme.textColor3");
}

.tag-box {
  width: 58px;
  display: flex;
  flex-shrink: 0;
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
  height: 22px;
  margin: 4px 0;
  border: 0;
  border-top: 1px dashed v-bind("theme.borderColor");
  border-bottom: 1px dashed v-bind("theme.borderColor");
  background: none;
  font: inherit;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.gap:hover {
  color: v-bind("theme.primaryColor");
}
</style>
