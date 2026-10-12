<script setup lang="ts">
import type { ProfileSolved, ProfileUnsolved } from "@oj2/contract"
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { dayLabel } from "oj/ai/utils"
import { parseTime } from "utils/functions"

/**
 * 做对的题：按天一行（或按知识点一行），一道题一块，带题名 —— 原来是一墙题号按钮，
 * 学生认不得题号。最上面一行是交过还没做对的（本人叫「差一点」，老师看叫「还没做对」）。
 */
const props = defineProps<{
  solved: ProfileSolved[]
  /** 本人和老师才有；同学看是 null */
  unsolved: ProfileUnsolved[] | null
  title: string
  /** 老师在看这个学生：没做对的题点进去看他的提交 */
  username?: string
  compact?: boolean
}>()

const theme = useThemeVars()

/** 一行最多先露几道，多的点「还有 N 道」 */
const PER_ROW = 12
/** 先露几行，「看更早的」一次再加这么多 */
const ROWS = 6

const mode = ref<"day" | "tag">("day")
const keyword = ref("")
const rowLimit = ref(ROWS)
const opened = ref(new Set<string>())

watch([mode, keyword], () => {
  rowLimit.value = ROWS
  opened.value = new Set()
})

const filtered = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return props.solved
  return props.solved.filter(
    (item) =>
      item.displayId.toLowerCase().includes(word) || item.title.toLowerCase().includes(word),
  )
})

interface Row {
  key: string
  label: string
  sub: string
  items: ProfileSolved[]
}

const rows = computed<Row[]>(() => {
  const groups = new Map<string, ProfileSolved[]>()
  if (mode.value === "day") {
    for (const item of filtered.value) {
      const day = parseTime(item.solvedAt, "YYYY-MM-DD")
      const list = groups.get(day)
      if (list) list.push(item)
      else groups.set(day, [item])
    }
    return [...groups].map(([day, items]) => {
      const { date, weekday } = dayLabel(day)
      return { key: day, label: date, sub: weekday, items }
    })
  }
  for (const item of filtered.value) {
    for (const tag of item.tags.length ? item.tags : ["其他"]) {
      const list = groups.get(tag)
      if (list) list.push(item)
      else groups.set(tag, [item])
    }
  }
  return [...groups]
    .map(([tag, items]) => ({ key: tag, label: tag, sub: "", items }))
    .sort(
      (a, b) =>
        Number(a.key === "其他") - Number(b.key === "其他") || b.items.length - a.items.length,
    )
})

/** 搜的时候全摊开，不再收着 */
const searching = computed(() => !!keyword.value.trim())
const shownRows = computed(() =>
  searching.value ? rows.value : rows.value.slice(0, rowLimit.value),
)

function itemsOf(row: Row) {
  return searching.value || opened.value.has(row.key) ? row.items : row.items.slice(0, PER_ROW)
}

function open(row: Row) {
  opened.value = new Set([...opened.value, row.key])
}

function unsolvedLink(item: ProfileUnsolved) {
  return props.username
    ? {
        path: "/submission",
        query: { problem: item.displayId, username: props.username, exactUsername: "1" },
      }
    : `/problem/${item.displayId}`
}
</script>

<template>
  <section class="card" :class="{ compact }">
    <div class="head">
      <h3>
        {{ title }} <small>{{ solved.length }} 道</small>
      </h3>
      <span class="grow"></span>
      <n-input
        v-if="solved.length"
        v-model:value="keyword"
        class="search"
        clearable
        placeholder="搜题号或题目"
        aria-label="搜题号或题目"
      >
        <template #prefix><Icon icon="ph:magnifying-glass" /></template>
      </n-input>
      <div v-if="solved.length" class="seg" role="group" aria-label="怎么排">
        <button type="button" :class="{ on: mode === 'day' }" @click="mode = 'day'">按日期</button>
        <button type="button" :class="{ on: mode === 'tag' }" @click="mode = 'tag'">
          按知识点
        </button>
      </div>
    </div>

    <div v-if="unsolved?.length && !searching" class="row">
      <div class="label warn">{{ username ? "还没做对" : "差一点" }}</div>
      <div class="chips">
        <router-link
          v-for="item in unsolved"
          :key="item.displayId"
          :to="unsolvedLink(item)"
          class="chip stuck"
        >
          <span class="id">{{ item.displayId }}</span>
          <span class="t">{{ item.title }}</span>
          <span class="s">交了 {{ item.attempts }} 次</span>
        </router-link>
      </div>
      <div class="count">{{ unsolved.length }} 道</div>
    </div>

    <div v-for="row in shownRows" :key="row.key" class="row">
      <div class="label">
        <b>{{ row.label }}</b> <span v-if="row.sub" class="sub">{{ row.sub }}</span>
      </div>
      <div class="chips">
        <router-link
          v-for="item in itemsOf(row)"
          :key="item.displayId"
          :to="`/problem/${item.displayId}`"
          class="chip ok"
        >
          <span class="id">{{ item.displayId }}</span>
          <span class="t">{{ item.title }}</span>
        </router-link>
        <button
          v-if="itemsOf(row).length < row.items.length"
          type="button"
          class="chip more"
          @click="open(row)"
        >
          还有 {{ row.items.length - PER_ROW }} 道 <Icon icon="ph:caret-down" />
        </button>
      </div>
      <div class="count">{{ row.items.length }} 道</div>
    </div>

    <div v-if="!searching && rows.length > rowLimit" class="foot">
      <button type="button" class="more-link" @click="rowLimit += ROWS">
        {{ mode === "day" ? "看更早的" : "看更多" }} <Icon icon="ph:caret-down" />
      </button>
    </div>
    <div v-if="searching && !rows.length" class="empty">没有对得上的题</div>
    <div v-if="!solved.length" class="empty">还没做对过题</div>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 20px 10px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

h3 {
  margin: 0;
  font-size: var(--oj-fs-h2);
}

h3 small {
  font-size: var(--oj-fs-sec);
  font-weight: 400;
  color: v-bind("theme.textColor3");
}

.grow {
  flex: 1;
}

.search {
  width: 200px;
}

.seg {
  display: inline-flex;
  height: var(--oj-ctrl-h);
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 4px;
  overflow: hidden;
}

.seg button {
  padding: 0 12px;
  border: 0;
  border-left: 1px solid v-bind("theme.borderColor");
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor2");
  font: inherit;
  font-size: var(--oj-fs-sec);
  cursor: pointer;
  white-space: nowrap;
}

.seg button:first-child {
  border-left: 0;
}

.seg button.on {
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
  font-weight: 600;
}

.row {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.label {
  width: 92px;
  flex-shrink: 0;
  line-height: 30px;
  font-size: var(--oj-fs-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.label .sub {
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
}

.label.warn {
  color: #b86e00;
  font-weight: 600;
  font-size: var(--oj-fs-sec);
}

.chips {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.count {
  width: 56px;
  flex-shrink: 0;
  text-align: right;
  line-height: 30px;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 300px;
  height: 30px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor1");
  text-decoration: none;
  white-space: nowrap;
}

.chip:hover {
  filter: brightness(0.97);
}

.chip .id {
  flex-shrink: 0;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
}

.chip .t {
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip .s {
  flex-shrink: 0;
  font-size: var(--oj-fs-meta);
  font-weight: 700;
  color: #b86e00;
}

.ok {
  background: rgba(24, 160, 88, 0.12);
}

.stuck {
  background: rgba(240, 160, 32, 0.15);
}

.more {
  border-color: v-bind("theme.borderColor");
  background: none;
  color: v-bind("theme.textColor2");
  font: inherit;
  font-size: var(--oj-fs-sec);
  cursor: pointer;
}

.foot {
  padding: 12px 0 2px;
  text-align: center;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.more-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  color: #18a058;
  font: inherit;
  font-size: var(--oj-fs-sec);
  cursor: pointer;
}

.empty {
  padding: 24px 0 18px;
  text-align: center;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
}

/* 手机：按日期、按知识点都改成一行一道（块在窄屏上一行只放得下一两个） */
.compact {
  padding: 4px 0 0;
  border: 0;
  border-radius: 0;
  background: none;
}

.compact .head h3,
.compact .head .grow {
  display: none;
}

.compact .search {
  width: auto;
  flex: 1 0 100%;
}

.compact .seg {
  flex: 1;
}

.compact .seg button {
  flex: 1;
}

.compact .row {
  flex-direction: column;
  gap: 6px;
}

.compact .label {
  width: auto;
  line-height: 22px;
}

.compact .count {
  display: none;
}

.compact .chips {
  flex-direction: column;
  gap: 0;
}

.compact .chip {
  max-width: none;
  height: 44px;
  padding: 0;
  border-radius: 0;
  background: none;
  border-top: 1px solid v-bind("theme.dividerColor");
  font-size: var(--oj-fs-body);
}

.compact .chip .id {
  width: 52px;
}

.compact .chip .t {
  flex: 1;
}

.compact .more {
  color: #18a058;
  border-left: 0;
  border-right: 0;
  border-bottom: 0;
}
</style>
