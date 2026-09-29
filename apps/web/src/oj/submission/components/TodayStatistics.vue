<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { getTodaySubmissionStatistics } from "oj/api"
import { JUDGE_STATUS, LANGUAGE_SHOW_VALUE } from "utils/constants"
import { parseTime, zonedParts } from "utils/functions"
import type { SUBMISSION_RESULT, TodaySubmissionStatistics } from "utils/types"
import { useTone, type Tone } from "../composables/tone"
import { classLabel } from "../utils"

/**
 * 今日统计（设计稿「今日统计重设计」）。一般是老师在看：今天哪几个班上了课、几点到几点、
 * 错得最多的是哪几道（老师 B）。学生版从简：自己今天怎样、大家在做哪几道。
 * 盯人、实时刷新是课堂看板的活，这里不做；有班正在上课时直接引过去。
 */
const emit = defineEmits<{
  close: []
  openProblem: [problem: string]
  /** 拉到数之后把总数报回去：按钮上的数只在进页面时拉过一次，停久了会对不上 */
  loaded: [total: number]
}>()

const router = useRouter()
const theme = useThemeVars()
const tone = useTone()

const stats = ref<TodaySubmissionStatistics | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    stats.value = await getTodaySubmissionStatistics()
    emit("loaded", stats.value.total)
  } catch {
    failed.value = true
  }
})

const teacher = computed(() => stats.value?.classes != null)

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

const headText = computed(() => {
  const at = stats.value?.asOf ?? new Date().toISOString()
  const p = zonedParts(at)!
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]
  return `${p.month}月${p.day}日 ${weekday} · 截至 ${parseTime(at, "HH:mm")}`
})

function resultName(result: number) {
  return JUDGE_STATUS[result as SUBMISSION_RESULT]?.name ?? "其他"
}

/** 结果条的颜色：答案正确绿、运行时错误橙、答案错误红、编译失败和判题中灰 */
function resultColor(result: number) {
  if (result === -2) return theme.value.textColor3
  // 等待评分 / 判题中：还没有结果，不该和运行时错误一样是橙色
  if (result === 6 || result === 7) return theme.value.borderColor
  const kind: Tone = JUDGE_STATUS[result as SUBMISSION_RESULT]?.type ?? "default"
  if (kind !== "success" && kind !== "error" && kind !== "warning") return theme.value.borderColor
  return tone(kind).color
}

function percent(value: number, total: number) {
  return total ? `${(value / total) * 100}%` : "0"
}

// ---------- 老师：各班时间轴 ----------

/** 东八区的「几点几分」换成小时的小数，给时间轴定位 */
function hourOf(value: string) {
  const p = zonedParts(value)!
  return p.hour + p.minute / 60
}

/** 横轴默认 7 点到 20 点（机房上课的时段），有更早更晚的提交就往外扩 */
const axis = computed(() => {
  const list = stats.value?.classes ?? []
  const start = Math.min(7, ...list.map((item) => Math.floor(hourOf(item.start))))
  const end = Math.max(20, ...list.map((item) => Math.ceil(hourOf(item.end))))
  return { start, end, ticks: Array.from({ length: end - start + 1 }, (_, i) => start + i) }
})

function axisLeft(hour: number) {
  const { start, end } = axis.value
  return `${((hour - start) / (end - start)) * 100}%`
}

function barStyle(item: { start: string; end: string; live: boolean }) {
  const from = hourOf(item.start)
  const to = hourOf(item.end)
  const { start, end } = axis.value
  return {
    left: axisLeft(from),
    width: `max(8px, ${((to - from) / (end - start)) * 100}%)`,
    background: item.live ? theme.value.successColor : "#3f5f87",
  }
}

/** 横条靠近右边时文字放到条的左边，不然「497 次 · 正确率 31%」被弹框右边裁掉 */
function textStyle(item: { start: string; end: string }) {
  const { start, end } = axis.value
  if ((hourOf(item.end) - start) / (end - start) > 0.72) {
    return { right: `calc(100% - ${axisLeft(hourOf(item.start))} + 10px)` }
  }
  return { left: `calc(${axisLeft(hourOf(item.end))} + 14px)` }
}

const nowHour = computed(() => {
  const at = stats.value?.asOf
  if (!at) return null
  const hour = hourOf(at)
  return hour >= axis.value.start && hour <= axis.value.end ? hour : null
})

const liveClasses = computed(() => (stats.value?.classes ?? []).filter((item) => item.live))

/** 23 人来了、花名册却只有 22（有个号不是学生角色）时，不写「23 / 22」 */
function attendance(item: { userCount: number; classSize: number }) {
  return item.classSize >= item.userCount
    ? `${item.userCount} / ${item.classSize} 人`
    : `${item.userCount} 人`
}

const scatteredText = computed(() =>
  (stats.value?.scattered ?? [])
    .map(
      (item) =>
        `${item.className ? classLabel(item.className) : "没填班级的"} ${item.userCount} 人 ${item.total} 次`,
    )
    .join("、"),
)

function openClass(className: string) {
  const href = router.resolve({
    name: "statistics",
    query: { className, period: "today" },
  }).href
  window.open(href, "_blank")
}

const judgedResults = computed(() => stats.value?.results ?? [])

const languageText = computed(() => {
  const list = stats.value?.languages ?? []
  if (!list.length) return ""
  if (list.length === 1) return `语言：全部是 ${LANGUAGE_SHOW_VALUE[list[0]!.language]}`
  return `语言：${list.map((item) => `${LANGUAGE_SHOW_VALUE[item.language]} ${item.count}`).join(" · ")}`
})

// ---------- 学生 ----------

const meText = computed(() => {
  const me = stats.value?.me
  if (!me) return ""
  return me.total ? `交了 ${me.total} 次，做对 ${me.solved} 道` : "还没交过"
})
</script>

<template>
  <div class="today" :class="{ wide: teacher }">
    <div class="head">
      <b class="title">今日统计</b>
      <n-text depth="3" class="small">{{ headText }}</n-text>
      <span v-if="stats?.judging" class="pill">判题中 {{ stats.judging }}</span>
      <span class="spacer"></span>
      <button type="button" class="close" aria-label="关闭" @click="emit('close')">
        <Icon icon="ph:x" :width="18" />
      </button>
    </div>

    <div class="body">
      <n-text v-if="failed" type="error">统计没拉下来，关掉再打开试试</n-text>
      <div v-else-if="!stats" class="center"><n-spin size="small" /></div>

      <div v-else-if="!stats.total" class="empty">
        <span class="empty-icon"><Icon icon="ph:chart-bar" :width="20" /></span>
        <b>今天还没有人交</b>
        <n-text depth="3">第一条提交进来之后这里就有数了</n-text>
      </div>

      <!-- ==================== 老师 ==================== -->
      <template v-else-if="teacher">
        <div class="numbers">
          <div>
            <b>{{ stats.total }}</b
            ><span>次提交</span>
          </div>
          <div>
            <b>{{ stats.userCount }}</b
            ><span>人</span>
          </div>
          <div>
            <b>{{ stats.correctRate }}%</b><span>提交正确率</span>
          </div>
          <div>
            <b>{{ stats.classes!.length }}</b
            ><span>个班上了课</span>
          </div>
        </div>

        <div
          v-if="liveClasses.length"
          class="live"
          :style="{ background: tone('success').background, color: tone('success').color }"
        >
          <span>
            {{ liveClasses.map((item) => classLabel(item.className)).join("、") }}正在上课
          </span>
          <span class="spacer"></span>
          <a href="#" class="live-link" @click.prevent="router.push('/classroom')">
            <Icon icon="ph:monitor" :width="14" />去课堂看板
          </a>
        </div>

        <template v-if="stats.classes!.length">
          <div class="section-title">
            <b>今天哪几个班上了课</b>
            <n-text depth="3" class="small">点班级名去数据统计看今天</n-text>
          </div>
          <div class="timeline">
            <div v-for="item in stats.classes" :key="item.className" class="lane">
              <div class="lane-label">
                <a href="#" class="lane-name" @click.prevent="openClass(item.className)">
                  {{ classLabel(item.className) }}
                </a>
                <n-text depth="3" class="tiny">
                  {{ attendance(item) }} · {{ item.fromProblemSet ? "题单" : ""
                  }}{{ item.problemCount }} 道题
                </n-text>
              </div>
              <div class="lane-track">
                <span
                  v-for="tick in axis.ticks"
                  :key="tick"
                  class="grid"
                  :style="{ left: axisLeft(tick) }"
                ></span>
                <span class="lane-bar" :style="barStyle(item)"></span>
                <span class="lane-text" :style="textStyle(item)">
                  {{ item.total }} 次 ·
                  {{ item.live ? "上课中" : `正确率 ${Math.round(item.correctRate)}%` }}
                </span>
                <span
                  v-if="nowHour !== null"
                  class="now"
                  :style="{ left: axisLeft(nowHour) }"
                ></span>
              </div>
            </div>
            <div class="lane axis-row">
              <div class="lane-label"></div>
              <div class="lane-track axis">
                <span v-for="tick in axis.ticks" :key="tick" :style="{ left: axisLeft(tick) }">
                  {{ tick }}
                </span>
                <span
                  v-if="nowHour !== null"
                  class="now-label"
                  :style="{ left: axisLeft(nowHour) }"
                >
                  现在
                </span>
              </div>
            </div>
          </div>
        </template>
        <n-text v-if="scatteredText" depth="3" class="small">
          {{ stats.classes!.length ? "另有零散提交：" : "今天没有哪个班一起上课，零散提交："
          }}{{ scatteredText }}
        </n-text>

        <template v-if="stats.hardProblems?.length">
          <div class="section-title">
            <b>错得最多的题</b>
            <n-text depth="3" class="small">按没过的次数</n-text>
          </div>
          <table class="hard">
            <thead>
              <tr>
                <th>题目</th>
                <th>哪个班</th>
                <th>提交</th>
                <th>没过的原因</th>
                <th class="right">做对</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in stats.hardProblems" :key="item.problemDisplayId">
                <td class="hard-title">
                  <a href="#" @click.prevent="emit('openProblem', item.problemDisplayId)">
                    <n-text depth="3">{{ item.problemDisplayId }}</n-text> {{ item.problemTitle }}
                  </a>
                </td>
                <td>
                  <n-text depth="2">{{ item.className ? classLabel(item.className) : "—" }}</n-text>
                </td>
                <td>{{ item.total }} 次</td>
                <td>
                  <span class="mini">
                    <span
                      :style="{
                        width: percent(item.accepted, item.total),
                        background: resultColor(0),
                      }"
                    ></span>
                    <span
                      v-for="fail in item.failures"
                      :key="fail.result"
                      :style="{
                        width: percent(fail.count, item.total),
                        background: resultColor(fail.result),
                      }"
                    ></span>
                  </span>
                  <n-text depth="2" class="small">
                    {{ resultName(item.failures[0]!.result) }} {{ item.failures[0]!.count }}
                  </n-text>
                </td>
                <td
                  class="right"
                  :style="{
                    color: item.acceptedUsers < item.userCount ? tone('error').color : undefined,
                    fontWeight: item.acceptedUsers < item.userCount ? 600 : undefined,
                  }"
                >
                  {{ item.acceptedUsers }} / {{ item.userCount }} 人
                </td>
              </tr>
            </tbody>
          </table>
        </template>

        <div class="foot">
          <div class="foot-bar">
            <div class="results">
              <span
                v-for="item in judgedResults"
                :key="item.result"
                :style="{
                  width: percent(item.count, stats.total),
                  background: resultColor(item.result),
                }"
              ></span>
            </div>
            <div class="legend">
              <span v-for="item in judgedResults.slice(0, 5)" :key="item.result">
                <i :style="{ background: resultColor(item.result) }"></i
                >{{ resultName(item.result) }}
                <b>{{ item.count }}</b>
              </span>
            </div>
          </div>
          <n-text depth="3" class="small foot-meta">
            {{ languageText }} ·
            {{ stats.flowchartCount ? `流程图 ${stats.flowchartCount} 张` : "流程图今天没人画" }}
          </n-text>
        </div>
      </template>

      <!-- ==================== 学生：从简 ==================== -->
      <template v-else>
        <div v-if="meText" class="me">
          <b>你今天</b>
          <n-text depth="2">{{ meText }}</n-text>
        </div>
        <div class="numbers">
          <div>
            <b>{{ stats.total }}</b
            ><span>次提交</span>
          </div>
          <div>
            <b>{{ stats.userCount }}</b
            ><span>人交了题</span>
          </div>
          <div>
            <b>{{ Math.round(stats.correctRate) }}%</b><span>提交做对了</span>
          </div>
        </div>
        <template v-if="stats.problems.length">
          <b class="section-title">今天大家都在做</b>
          <div class="rows">
            <a
              v-for="item in stats.problems"
              :key="item.problemDisplayId"
              href="#"
              class="row"
              @click.prevent="emit('openProblem', item.problemDisplayId)"
            >
              <span class="row-title">
                <n-text depth="3">{{ item.problemDisplayId }}</n-text> {{ item.problemTitle }}
              </span>
              <n-text depth="3" class="small">
                {{ item.userCount }} 人做 · {{ item.acceptedUsers }} 人对
              </n-text>
              <span v-if="item.mine === 'accepted'" class="mine done">
                <Icon icon="ph:check-bold" :width="12" />做对了
              </span>
              <span v-else class="mine go">{{ item.mine === "tried" ? "接着做" : "去做" }} ›</span>
            </a>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.today {
  width: min(560px, calc(100vw - 32px));
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: v-bind("theme.cardColor");
  box-shadow: v-bind("theme.boxShadow3");
  font-size: 14px;
  overflow: hidden;
}

.today.wide {
  width: min(880px, calc(100vw - 32px));
}

.head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 14px 24px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.title {
  font-size: 18px;
}

.pill {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor2");
}

.spacer {
  flex: 1 1 0;
}

.close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: v-bind("theme.textColor2");
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.close:hover {
  background: v-bind("theme.actionColor");
}

.body {
  overflow: auto;
  padding: 18px 24px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.small {
  font-size: 13px;
}

.tiny {
  font-size: 12px;
}

.center {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.empty {
  padding: 40px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.empty-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor2");
}

.numbers {
  display: flex;
  gap: 36px;
  flex-wrap: wrap;
}

.numbers > div {
  display: flex;
  flex-direction: column;
}

.numbers b {
  font-size: 26px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.numbers span {
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.live {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-radius: 8px;
}

.live-link {
  color: inherit;
  font-weight: 600;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.section-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.timeline {
  display: flex;
  flex-direction: column;
}

.lane {
  display: flex;
  min-height: 42px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.lane.axis-row {
  min-height: 24px;
  border-bottom: 0;
}

.lane-label {
  width: 150px;
  flex: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.lane-name {
  font-weight: 600;
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.lane-name:hover {
  color: v-bind("theme.primaryColor");
}

.lane-track {
  position: relative;
  flex: 1;
}

.grid {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: v-bind("theme.dividerColor");
}

.lane-bar {
  position: absolute;
  top: 50%;
  height: 16px;
  margin-top: -8px;
  border-radius: 4px;
}

.lane-text {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 13px;
  white-space: nowrap;
  color: v-bind("theme.textColor2");
}

.now {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  background: v-bind("theme.successColor");
}

.axis span {
  position: absolute;
  top: 4px;
  transform: translateX(-50%);
  font-size: 11px;
  color: v-bind("theme.textColor3");
}

.axis .now-label {
  top: 4px;
  font-weight: 600;
  color: v-bind("theme.successColor");
  background: v-bind("theme.cardColor");
  padding: 0 2px;
}

.hard {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.hard th {
  text-align: left;
  font-weight: normal;
  color: v-bind("theme.textColor3");
  padding: 4px 8px 6px 0;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.hard td {
  padding: 8px 8px 8px 0;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  white-space: nowrap;
}

.hard .right {
  text-align: right;
  padding-right: 0;
}

.hard-title a {
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.hard-title a:hover {
  color: v-bind("theme.primaryColor");
}

.mini {
  display: inline-flex;
  width: 70px;
  height: 8px;
  border-radius: 2px;
  overflow: hidden;
  gap: 1px;
  margin-right: 8px;
  vertical-align: middle;
}

.foot {
  display: flex;
  align-items: flex-end;
  gap: 24px;
  flex-wrap: wrap;
}

.foot-bar {
  flex: 1;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.results {
  display: flex;
  height: 10px;
  border-radius: 3px;
  overflow: hidden;
  gap: 1px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.legend i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  margin-right: 5px;
}

.me {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  background: v-bind("theme.actionColor");
}

.rows {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 2px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mine {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.mine.done {
  color: v-bind("theme.successColor");
}

.mine.go {
  color: v-bind("theme.primaryColor");
}
</style>
