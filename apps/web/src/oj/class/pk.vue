<script setup lang="ts">
import type { ClassBattleItem, ClassPk, ClassPkPeriod } from "@oj2/contract"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { useThemeVars } from "naive-ui"
import { getClassBattle, getClassPk } from "oj/api"
import { classLabel } from "oj/submission/utils"
import { useAIStream } from "shared/composables/aiStream"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import PkDuel from "./components/PkDuel.vue"
import PkGrid from "./components/PkGrid.vue"
import PkRace from "./components/PkRace.vue"
import { pkColor } from "./utils"

/**
 * 班级 PK（设计稿「班级 PK 重设计」定稿）。用户定的：两个班按「同一批题」对决（B），
 * 三个班以上按题对照（C），学生也能看。原来的综合分、雷达图、十张柱状图、四分位数都去掉了。
 *
 * 选了哪些班、看哪段时间都在地址栏里（`?classes=252,253&period=term`），从排名页、班级详情
 * 进来可以直接带上；不带就用自己的班（老师用默认的班），后端再配一个同年级的对手。
 */
const router = useRouter()
const route = useRoute()
const message = useMessage()
const theme = useThemeVars()
const userStore = useUserStore()
const { isDesktop } = useBreakpoints()

const MAX_CLASSES = 8

const teacher = computed(() => userStore.isTeacherOrAbove)
const pk = ref<ClassPk | null>(null)
const loading = ref(false)
const battle = ref<ClassBattleItem[]>([])

function queryClasses() {
  const raw = route.query.classes
  return typeof raw === "string" && raw ? raw.split(",").filter(Boolean) : []
}
const period = computed<ClassPkPeriod>(() => (route.query.period === "week" ? "week" : "term"))

let seq = 0
async function load() {
  const mine = ++seq
  loading.value = true
  try {
    const data = await getClassPk(queryClasses(), period.value)
    if (mine !== seq) return
    pk.value = data
    // 后端配好的班写回地址栏：刷新、分享出去看到的是同一组
    const classes = data.classes.map((item) => item.className).join(",")
    if (classes && classes !== route.query.classes)
      router.replace({ query: { ...route.query, classes } })
  } catch {
    if (mine === seq) pk.value = null
  } finally {
    if (mine === seq) loading.value = false
  }
}

watch(() => [route.query.classes, route.query.period], load, { immediate: true })

onMounted(async () => {
  try {
    battle.value = await getClassBattle()
  } catch {
    battle.value = []
  }
})

const selected = computed(() => pk.value?.classes.map((item) => item.className) ?? [])

function setClasses(classes: string[]) {
  report.value = ""
  ai.abort()
  router.push({ query: { ...route.query, classes: classes.join(",") || undefined } })
}

function remove(className: string) {
  setClasses(selected.value.filter((name) => name !== className))
}

function replace(from: string, to: string) {
  if (selected.value.includes(to)) return
  setClasses(selected.value.map((name) => (name === from ? to : name)))
}

function chipLabel(className: string) {
  return isDesktop.value ? classLabel(className) : `${className.slice(2)}班`
}

function add(className: string) {
  if (selected.value.includes(className)) return
  setClasses([...selected.value, className])
}

function setPeriod(value: ClassPkPeriod) {
  report.value = ""
  ai.abort()
  router.push({ query: { ...route.query, period: value === "term" ? undefined : value } })
}

/** 「+ 加一个班」：这学期在用的班（班级对抗里有的），按年级分组，自己年级放最前 */
const addOptions = computed(() => {
  const grade = selected.value[0]?.slice(0, 2)
  const groups = new Map<string, { label: string; value: string }[]>()
  for (const item of battle.value) {
    if (selected.value.includes(item.className)) continue
    const key = item.className.slice(0, 2)
    const list = groups.get(key) ?? []
    list.push({ label: classLabel(item.className), value: item.className })
    groups.set(key, list)
  }
  return [...groups]
    .sort((a, b) => (a[0] === grade ? -1 : b[0] === grade ? 1 : b[0].localeCompare(a[0])))
    .map(([key, children]) => ({
      type: "group" as const,
      label: `${key} 级`,
      key,
      children: children.sort((a, b) => a.value.localeCompare(b.value, "zh", { numeric: true })),
    }))
})

const mode = computed(() => {
  if (!pk.value || pk.value.classes.length < 2) return "empty"
  return pk.value.classes.length === 2 ? "duel" : "grid"
})

const ruleText = computed(() =>
  mode.value === "grid"
    ? "三个班以上按题对照 · 过半的人交过算这个班布置过"
    : "两个班只比都布置过的题 · 过半的人交过算布置过",
)

// ---------- AI 分析（只给老师） ----------
const ai = useAIStream()
const report = ref("")
const showReport = ref(false)

async function analyze() {
  if (selected.value.length < 2) return
  showReport.value = true
  report.value = ""
  try {
    await ai.run(
      "ai/class-pk-analysis",
      { classNames: selected.value, period: period.value },
      { onDelta: (content) => (report.value += content) },
    )
  } catch (error) {
    if (!report.value) showReport.value = false
    message.error((error as Error).message)
  }
}
</script>

<template>
  <div class="pk-page oj-page" :class="{ compact: !isDesktop }">
    <div class="toolbar">
      <div class="title-line">
        <router-link to="/rank" class="back">‹ 排名</router-link>
        <h2>班级 PK</h2>
        <span v-if="isDesktop" class="muted">{{ ruleText }}</span>
        <div class="spacer" />
        <div v-if="isDesktop" class="seg" role="group" aria-label="时间">
          <button :class="{ on: period === 'week' }" @click="setPeriod('week')">这周</button>
          <button :class="{ on: period === 'term' }" @click="setPeriod('term')">这学期</button>
        </div>
        <n-button
          v-if="teacher && isDesktop"
          size="small"
          secondary
          type="info"
          :disabled="selected.length < 2"
          :loading="ai.waiting.value"
          @click="analyze"
        >
          <template #icon>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
            </svg>
          </template>
          AI 分析
        </n-button>
      </div>
      <div class="chips">
        <template v-for="(className, index) in selected" :key="className">
          <span v-if="index === 1 && selected.length === 2" class="vs">VS</span>
          <span v-if="className === pk?.mine || selected.length > 2" class="chip">
            <i :style="{ background: pkColor(index) }" />
            {{ chipLabel(className) }}
            <span v-if="className === pk?.mine" class="mine-tag">你们班</span>
            <button
              v-else
              class="x"
              :aria-label="`去掉${classLabel(className)}`"
              @click="remove(className)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </span>
          <!-- 只剩两个班时不能删（删成一个班后端会再配一个），点它换成别的班 -->
          <n-popselect
            v-else
            :options="addOptions"
            scrollable
            trigger="click"
            :value="null"
            @update:value="(value: string) => replace(className, value)"
          >
            <button class="chip" title="换一个班">
              <i :style="{ background: pkColor(index) }" />
              {{ chipLabel(className) }}
              <svg
                class="chev"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </n-popselect>
        </template>
        <n-popselect
          v-if="selected.length < MAX_CLASSES"
          :options="addOptions"
          scrollable
          trigger="click"
          :value="null"
          @update:value="add"
        >
          <button class="chip add">+ 加一个班</button>
        </n-popselect>
      </div>
      <div v-if="!isDesktop" class="seg wide" role="group" aria-label="时间">
        <button :class="{ on: period === 'week' }" @click="setPeriod('week')">这周</button>
        <button :class="{ on: period === 'term' }" @click="setPeriod('term')">这学期</button>
      </div>
    </div>

    <n-spin :show="loading">
      <template v-if="pk">
        <div v-if="mode === 'empty'" class="card empty">
          <b>再加一个班来比</b>
          <span class="muted">
            {{
              pk.classes.length
                ? "同年级没找到别的在用的班，点上面「+ 加一个班」挑一个"
                : "你还没有班级，点上面「+ 加一个班」挑两个班来比"
            }}
          </span>
        </div>
        <template v-else>
          <div v-if="!pk.problems.length" class="card empty">
            <b>这几个班{{ period === "week" ? "这周" : "这学期" }}还没有一起布置过的题</b>
            <span class="muted"
              >一个班过半的人交过这道题才算布置过，至少两个班都布置过才能按题比</span
            >
            <PkRace v-if="period === 'term'" :pk="pk" :height="240" class="empty-race" />
          </div>
          <PkDuel v-else-if="mode === 'duel'" :pk="pk" :compact="!isDesktop" />
          <PkGrid v-else :pk="pk" :compact="!isDesktop" />
        </template>

        <section v-if="teacher && showReport" class="ai">
          <div class="ai-head">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
            </svg>
            <b>AI 分析</b>
            <span class="muted">根据上面这些数字写，仅供参考</span>
            <div class="spacer" />
            <n-button size="small" :loading="ai.running.value" @click="analyze">重新分析</n-button>
          </div>
          <span v-if="ai.waiting.value" class="muted">正在看这几个班的数据…</span>
          <MdPreview v-if="report" class="report" :model-value="report" />
        </section>
      </template>
      <div v-else-if="!loading" class="card empty">
        <b>没取到数据</b><span class="muted">刷新一下试试</span>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
/* 比别的阅读型页面宽：三个班以上是一张「题 × 班」的对照格，班多了格子会挤 */
.pk-page {
  max-width: 1440px;
  display: flex;
  flex-direction: column;
  gap: var(--oj-gap);
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.title-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.title-line h2 {
  margin: 0;
  font-size: var(--oj-fs-title);
}

.back {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.primaryColor");
  text-decoration: none;
}

.spacer {
  flex-grow: 1;
}

.muted {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
}

.seg {
  display: inline-flex;
  height: var(--oj-ctrl-h);
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 4px;
  overflow: hidden;
}

.seg button {
  padding: 0 14px;
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

.seg.wide button {
  flex: 1;
}

.chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  height: var(--oj-ctrl-h);
  box-sizing: border-box;
  padding: 0 10px 0 12px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 17px;
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor1");
  font: inherit;
  font-size: var(--oj-fs-sec);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.chip i {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  flex-shrink: 0;
}

.chip.add {
  padding: 0 14px;
  border-style: dashed;
  font-weight: 400;
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.x {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  background: none;
  color: v-bind("theme.textColor3");
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.x svg {
  width: 12px;
  height: 12px;
}

button.chip {
  cursor: pointer;
}

.chev {
  width: 12px;
  height: 12px;
  color: v-bind("theme.textColor3");
}

.x:hover {
  color: v-bind("theme.textColor1");
}

.vs {
  font-weight: 800;
  font-size: 16px;
  font-style: italic;
  color: v-bind("theme.textColor3");
}

.mine-tag {
  font-size: 12px;
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
  border-radius: 3px;
  padding: 0 6px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  font-weight: 600;
}

.card {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
}

.empty {
  min-height: 200px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
}

.empty-race {
  max-width: 700px;
  margin-top: 12px;
}

.ai {
  margin-top: 16px;
  padding: 16px 20px;
  border-radius: var(--oj-radius);
  border: 1px solid rgba(47, 111, 208, 0.3);
  background: rgba(47, 111, 208, 0.05);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: #2f6fd0;
}

.ai-head b {
  color: v-bind("theme.textColor1");
}

.ai-head .muted {
  font-size: var(--oj-fs-meta);
}

.report {
  background: transparent;
}

.report :deep(.md-editor-preview-wrapper) {
  padding: 0;
}

.compact .chip {
  font-size: var(--oj-fs-meta);
}
</style>
