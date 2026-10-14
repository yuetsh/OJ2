<script lang="ts" setup>
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { getReaction, setReaction } from "oj/api"
import { useProblemStore } from "oj/store/problem"
import { useUserStore } from "shared/store/user"
import { REACTIONS } from "utils/constants"
import type { ReactionCounts, ReactionKey } from "utils/types"

/**
 * 题目点评轮盘：七个选项，每人每题只能评一次，做对了才能评。
 *
 * 和原来那个轮盘比：
 * - 每块上**直接写着表情和名字**，字号跟着轮盘走（最大 16px），不用先把鼠标移过去才看得清；
 *   原来每块的字只有 12px 左右
 * - **选之前哪里都没有人数**（后端本来就要自己评过才返回 counts），圆心只报悬停的那一项，
 *   免得跟风；选完就地变成玫瑰图：每块从里往外填一段，长短按人数，标出「N 人」
 * - 扇区是 SVG 画的。原来是 CSS clip-path 加 `color-mix()`，后者 Chrome 111 才有，
 *   机房 105 那档整条声明作废、扇区没有底色
 *
 * `guard`：AC 之后那个强制弹窗用。弹窗是自己冒出来的，学生手还在键盘上、鼠标还停在
 * 原来的位置（很可能正好压在某一块上），所以前 600ms 点不了，也不响应 Enter / 空格；
 * 扇区不进 Tab 顺序，不会被预选。抽屉里的是学生自己点开的，不设防、键盘能用。
 */
const props = defineProps<{ guard?: boolean }>()
const emit = defineEmits<{ submitted: [] }>()

const GUARD_MS = 600

const userStore = useUserStore()
const { problem } = storeToRefs(useProblemStore())
const theme = useThemeVars()

const mine = ref<ReactionKey | null>(null)
const counts = ref<ReactionCounts | null>(null)
const loading = ref(false)
const loadFailed = ref(false)
const submitting = ref<ReactionKey | null>(null)
const submitFailed = ref(false)
const ready = ref(!props.guard)
const activeIndex = ref<number | null>(null)
let loadSequence = 0

// ==================== 几何 ====================
// viewBox 400 × 400，圆心 (200, 200)。标签是盖在 SVG 上的一层 HTML，按百分比定位
const C = 200
const OUTER = 192
const INNER = 70
const LABEL_RADIUS = 136
/** 悬停 / 选中时往外弹出的距离（viewBox 单位） */
const POP = 7
const step = 360 / REACTIONS.length

function polar(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180
  return { x: C + Math.cos(rad) * radius, y: C + Math.sin(rad) * radius }
}

/** 一块环形扇区：外弧 → 内弧 */
function sectorPath(start: number, end: number, inner: number, outer: number) {
  const a = polar(start, outer)
  const b = polar(end, outer)
  const c = polar(end, inner)
  const d = polar(start, inner)
  const f = (n: number) => n.toFixed(2)
  return [
    `M${f(a.x)} ${f(a.y)}`,
    `A${outer} ${outer} 0 0 1 ${f(b.x)} ${f(b.y)}`,
    `L${f(c.x)} ${f(c.y)}`,
    `A${inner} ${inner} 0 0 0 ${f(d.x)} ${f(d.y)}`,
    "Z",
  ].join(" ")
}

// 第一项正对 12 点，顺时针排
const sectors = REACTIONS.map((item, index) => {
  const mid = -90 + index * step
  const label = polar(mid, LABEL_RADIUS)
  const rad = (mid * Math.PI) / 180
  return {
    ...item,
    index,
    path: sectorPath(mid - step / 2, mid + step / 2, INNER, OUTER),
    mid,
    left: `${(label.x / 400) * 100}%`,
    top: `${(label.y / 400) * 100}%`,
    popX: Math.cos(rad) * POP,
    popY: Math.sin(rad) * POP,
  }
})

// ==================== 状态 ====================
const solved = computed(() => problem.value?.myStatus === 0)

type WheelState = "anonymous" | "loading" | "failed" | "locked" | "choose" | "results"
const state = computed<WheelState>(() => {
  if (!userStore.isAuthed) return "anonymous"
  if (loading.value) return "loading"
  if (loadFailed.value) return "failed"
  if (mine.value !== null && counts.value) return "results"
  if (solved.value) return "choose"
  return "locked"
})

const choosable = computed(() => state.value === "choose")
const canPick = computed(() => choosable.value && ready.value && !submitting.value)

// 从能选的那一刻起算：换题、登录之后重新能选，也重新算
const { start: armGuard, stop: disarmGuard } = useTimeoutFn(
  () => {
    ready.value = true
  },
  GUARD_MS,
  { immediate: false },
)
watch(
  choosable,
  (value) => {
    if (!value || !props.guard) return
    ready.value = false
    activeIndex.value = null
    disarmGuard()
    armGuard()
  },
  { immediate: true },
)

// ==================== 玫瑰图（选完之后） ====================
const results = computed(() => {
  const all = counts.value
  if (state.value !== "results" || !all) return null
  const values = REACTIONS.map((item) => all[item.key] ?? 0)
  const max = Math.max(1, ...values)
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    petals: sectors.map((sector, index) => {
      const count = values[index] ?? 0
      // 一个人都没有的那块不画；有人的至少露出一截，不然 1 人和 0 人看着一样
      const reach = count === 0 ? 0 : 0.12 + 0.88 * (count / max)
      const path =
        reach === 0
          ? ""
          : sectorPath(
              sector.mid - step / 2,
              sector.mid + step / 2,
              INNER,
              INNER + (OUTER - INNER) * reach,
            )
      return { count, path }
    }),
  }
})

// ==================== 圆心 ====================
const labelOf = (key: ReactionKey | null) => REACTIONS.find((item) => item.key === key)?.label ?? ""

const center = computed<{ small: string; big: string; foot?: string }>(() => {
  switch (state.value) {
    case "anonymous":
      return { small: "登录之后", big: "才能点评" }
    case "loading":
      return { small: "正在读取", big: "…" }
    case "failed":
      return { small: "暂时读不出来", big: "过会儿再看" }
    case "locked":
      return { small: "做对之后", big: "才能点评" }
    case "results":
      return {
        small: "你选了",
        big: labelOf(mine.value),
        foot: `共 ${results.value?.total ?? 0} 人评过`,
      }
  }
  if (submitting.value) return { small: "正在记下", big: labelOf(submitting.value) }
  if (activeIndex.value !== null) {
    return { small: "选这个？", big: REACTIONS[activeIndex.value]?.label ?? "" }
  }
  return { small: "点一块", big: "选一个" }
})

// ==================== 交互 ====================
function preview(index: number | null) {
  if (!canPick.value) return
  activeIndex.value = index
}

function onSectorClick(key: ReactionKey, event: MouseEvent) {
  // 键盘触发的 click（Enter / 空格）detail 是 0
  if (props.guard && event.detail === 0) return
  pick(key)
}

function onSectorKey(key: ReactionKey) {
  if (!props.guard) pick(key)
}

async function pick(key: ReactionKey) {
  const current = problem.value
  if (!canPick.value || !current) return
  submitting.value = key
  submitFailed.value = false
  try {
    const res = await setReaction(current.id, key)
    mine.value = res.mine
    counts.value = res.counts
    activeIndex.value = null
    emit("submitted")
  } catch {
    // 留在这里让他再点一次：强制弹窗关不掉，没有别的出路
    submitFailed.value = true
  } finally {
    submitting.value = null
  }
}

async function load(problemId: number) {
  const sequence = ++loadSequence
  loading.value = true
  loadFailed.value = false
  try {
    const res = await getReaction(problemId)
    if (sequence !== loadSequence) return
    mine.value = res.mine
    counts.value = res.counts
  } catch {
    if (sequence === loadSequence) loadFailed.value = true
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

watch(
  [() => userStore.isAuthed, () => problem.value?.id],
  ([isAuthed, problemId]) => {
    mine.value = null
    counts.value = null
    submitting.value = null
    submitFailed.value = false
    activeIndex.value = null
    if (!isAuthed || problemId === undefined) {
      loadSequence += 1
      loading.value = false
      return
    }
    load(problemId)
  },
  { immediate: true },
)

function sectorAriaLabel(index: number) {
  const item = REACTIONS[index]!
  if (!results.value) return item.label
  const count = results.value.petals[index]?.count ?? 0
  return `${item.label}，${count} 人${mine.value === item.key ? "，你的选择" : ""}`
}
</script>

<template>
  <section
    class="reaction"
    :style="{
      '--accent': theme.primaryColor,
      // 抽屉和弹窗的底色是 modalColor（暗色下比 cardColor 浅一档），缝和圆心要和它一样
      '--card': theme.modalColor,
      '--border': theme.borderColor,
      '--text': theme.textColor1,
      '--faint': theme.textColor3,
    }"
    aria-label="题目点评"
  >
    <p v-if="choosable" class="hint">
      选一块最接近的，<b>每道题只能评一次</b>。选完就能看到大家是怎么选的
    </p>

    <div
      class="wheel"
      :class="[`is-${state}`, { 'is-waiting': choosable && !ready }]"
      @pointerleave="preview(null)"
    >
      <svg viewBox="0 0 400 400" class="wheel-svg">
        <g
          v-for="sector in sectors"
          :key="sector.key"
          class="sector"
          :class="{
            active: activeIndex === sector.index,
            picking: submitting === sector.key,
            mine: mine === sector.key,
          }"
          :style="{ '--pop-x': `${sector.popX}px`, '--pop-y': `${sector.popY}px` }"
          :role="choosable ? 'button' : 'img'"
          :tabindex="choosable && !guard ? 0 : -1"
          :aria-label="sectorAriaLabel(sector.index)"
          :aria-disabled="!canPick"
          @pointerenter="preview(sector.index)"
          @focus="preview(sector.index)"
          @blur="preview(null)"
          @click="onSectorClick(sector.key, $event)"
          @keydown.enter.prevent="onSectorKey(sector.key)"
          @keydown.space.prevent="onSectorKey(sector.key)"
        >
          <path class="sector-face" :d="sector.path" />
          <!-- 选完之后的玫瑰图：从里往外填一段，长短按人数 -->
          <path
            v-if="results?.petals[sector.index]?.path"
            class="petal"
            :d="results.petals[sector.index]!.path"
          />
        </g>
        <circle class="core" :cx="C" :cy="C" :r="INNER - 4" />
      </svg>

      <!-- 标签层是 HTML（表情图标是 Iconify 组件），跟着扇区一起弹出 -->
      <div
        v-for="sector in sectors"
        :key="`${sector.key}-label`"
        class="label"
        :class="{
          active: activeIndex === sector.index,
          picking: submitting === sector.key,
          mine: mine === sector.key,
        }"
        :style="{
          left: sector.left,
          top: sector.top,
          '--pop-x': `${(sector.popX / 400) * 100}cqi`,
          '--pop-y': `${(sector.popY / 400) * 100}cqi`,
        }"
        aria-hidden="true"
      >
        <span class="label-icon">
          <n-spin v-if="submitting === sector.key" :size="18" />
          <Icon v-else :icon="sector.icon" />
        </span>
        <span class="label-text">{{ sector.label }}</span>
        <span v-if="results" class="label-count">
          {{ mine === sector.key ? "✓ " : "" }}{{ results.petals[sector.index]?.count ?? 0 }} 人
        </span>
      </div>

      <div class="center" aria-live="polite">
        <span class="center-small">{{ center.small }}</span>
        <strong class="center-big">{{ center.big }}</strong>
        <span v-if="center.foot" class="center-small">{{ center.foot }}</span>
      </div>
    </div>

    <p v-if="submitFailed" class="error">没记上，再点一次</p>
    <!--
      强制弹窗关不掉，这个插槽（「下一题 / 继续」）是唯一的出口：读不出点评、交点评失败时也得给，
      不能把学生关在弹窗里（设计文档第 7 节：接口出错时不能把学生卡住）
    -->
    <div
      v-if="(state === 'results' || state === 'failed' || submitFailed) && $slots.after"
      class="after"
    >
      <slot name="after" />
    </div>
  </section>
</template>

<style scoped>
.reaction {
  max-width: 560px;
  margin: 0 auto;
  color: var(--text);
}

.hint {
  margin: 0 0 12px;
  text-align: center;
  font-size: 14px;
  color: var(--faint);
}

.hint b {
  color: var(--text);
}

.wheel {
  position: relative;
  width: min(100%, 400px);
  aspect-ratio: 1;
  margin: 0 auto;
  /* 标签字号、弹出距离都按轮盘宽度算（cqi，Chrome 105 起有） */
  container-type: inline-size;
  user-select: none;
  transition: opacity 0.25s;
}

/* 防误触那 600ms：看得出是「还没好」，而不是坏了 */
.wheel.is-waiting {
  opacity: 0.45;
  pointer-events: none;
}

.wheel-svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* ---------- 扇区 ---------- */
.sector {
  outline: none;
  transition: transform 0.16s cubic-bezier(0, 0, 0.2, 1);
}

.sector-face {
  fill: var(--faint);
  fill-opacity: 0.1;
  /* 卡片色的粗描边就是扇区之间的缝，宽度处处一样 */
  stroke: var(--card);
  stroke-width: 4;
  stroke-linejoin: round;
  transition:
    fill 0.16s,
    fill-opacity 0.16s;
}

.is-choose .sector {
  cursor: pointer;
}

.is-choose .sector.active,
.sector.picking,
.sector.mine {
  transform: translate(var(--pop-x), var(--pop-y));
}

.is-choose .sector.active .sector-face,
.sector.picking .sector-face {
  fill: var(--accent);
  fill-opacity: 0.18;
}

.sector:focus-visible .sector-face {
  stroke: var(--accent);
  stroke-width: 3;
}

/* 没登录、没做对、读不出来：轮盘照画，整个淡下去 */
.is-anonymous .sector-face,
.is-locked .sector-face,
.is-failed .sector-face,
.is-loading .sector-face {
  fill-opacity: 0.05;
}

/* ---------- 选完：玫瑰图 ---------- */
.petal {
  fill: var(--faint);
  fill-opacity: 0.28;
  stroke: var(--card);
  stroke-width: 4;
  pointer-events: none;
}

.sector.mine .sector-face {
  fill: var(--accent);
  fill-opacity: 0.1;
}

.sector.mine .petal {
  fill: var(--accent);
  fill-opacity: 0.5;
}

.core {
  fill: var(--card);
  stroke: var(--border);
  stroke-width: 1;
}

/* ---------- 标签 ---------- */
.label {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  white-space: nowrap;
  transition: transform 0.16s cubic-bezier(0, 0, 0.2, 1);
}

.is-choose .label.active,
.label.picking,
.label.mine {
  transform: translate(calc(-50% + var(--pop-x)), calc(-50% + var(--pop-y))) scale(1.08);
}

.label-icon {
  display: flex;
  font-size: clamp(22px, 8cqi, 32px);
  line-height: 1;
}

.label-text {
  font-size: clamp(12px, 4cqi, 16px);
  font-weight: 600;
}

.label-count {
  font-size: clamp(11px, 3.2cqi, 13px);
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

.label.mine .label-count {
  color: var(--accent);
  font-weight: 600;
}

.is-anonymous .label,
.is-locked .label,
.is-failed .label,
.is-loading .label {
  opacity: 0.45;
}

/* ---------- 圆心 ---------- */
.center {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 30%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  text-align: center;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.center-small {
  font-size: clamp(10px, 3cqi, 12px);
  color: var(--faint);
}

.center-big {
  font-size: clamp(14px, 4.6cqi, 18px);
  line-height: 1.2;
}

.error {
  margin: 10px 0 0;
  text-align: center;
  color: v-bind("theme.errorColor");
}

.after {
  margin-top: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .sector,
  .label {
    transition: none;
  }
}
</style>
