<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import type { SubmissionLessons } from "@oj2/contract"
import { parseTime, zonedParts } from "utils/functions"
import { useTone } from "oj/submission/composables/tone"
import { classLabel } from "oj/submission/utils"
import { resultName, useResultColor } from "../results"

type Lesson = SubmissionLessons["lessons"][number]
type Scattered = SubmissionLessons["scattered"][number]

/**
 * 统计「一行一节课」的总览（设计稿「统计合二为一」B）。没选班、没填学生和题号时用它：
 * 原来「今日统计」老师那一版（今天哪几个班上了课、几点到几点、错得最多的题）并进来，
 * 换成任意时间段。按天分组，从近到远 —— 这节课在最上面；点一行进那节课（班、题、时段都带上）。
 * 课怎么切的在后端（契约 submissionLessonsSchema）。
 */
const props = defineProps<{
  data: SubmissionLessons
  /** 时间段落在今天以内：每行多一根 7–20 点的横条（原来今日统计的时间轴） */
  timeline: boolean
  /** 「再往前看」在加载 */
  loadingMore: boolean
}>()
const emit = defineEmits<{
  pick: [lesson: Lesson]
  /** 点某天的零散提交：那个班（或没填班级的）那一天 */
  scattered: [item: Scattered]
  /** 点「错得最多的题」里的一道：只看这道（按班级汇总） */
  problem: [displayId: string]
  more: []
}>()

const router = useRouter()
const theme = useThemeVars()
const tone = useTone()
const resultColor = useResultColor()

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

function dayText(day: string) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const today = parseTime(new Date(), "YYYY-MM-DD")
  const yesterday = parseTime(new Date(Date.now() - 86_400_000), "YYYY-MM-DD")
  const date = `${m}月${d}日 ${weekday}`
  if (day === today) return `今天 · ${date}`
  if (day === yesterday) return `昨天 · ${date}`
  return y === Number(today.slice(0, 4)) ? date : `${y}年${date}`
}

/** 按天分组，天和天里的课都是从近到远，零散提交挂在对应那天下面 */
const days = computed(() => {
  const map = new Map<string, Lesson[]>()
  for (const lesson of props.data.lessons) {
    map.set(lesson.day, [...(map.get(lesson.day) ?? []), lesson])
  }
  const scatteredByDay = new Map<string, Scattered[]>()
  for (const item of props.data.scattered) {
    scatteredByDay.set(item.day, [...(scatteredByDay.get(item.day) ?? []), item])
    if (!map.has(item.day)) map.set(item.day, [])
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, lessons]) => ({
      day,
      label: dayText(day),
      // 最近的一节在最上面（用户说的）：打开就看到这节课，往下是更早的
      lessons: [...lessons].sort((a, b) => b.start.localeCompare(a.start)),
      scattered: scatteredByDay.get(day) ?? [],
    }))
})

const lessonCount = computed(() => props.data.lessons.length)
const liveLessons = computed(() => props.data.lessons.filter((lesson) => lesson.live))

function clock(lesson: Lesson) {
  return `${parseTime(lesson.start, "HH:mm")}–${parseTime(lesson.end, "HH:mm")}`
}

/** 23 人来了、花名册却只有 22（有个号不是学生角色）时，不写「23 / 22」 */
function attendance(lesson: Lesson) {
  return lesson.classSize >= lesson.userCount
    ? `${lesson.userCount} / ${lesson.classSize} 人`
    : `${lesson.userCount} 人`
}

function problemText(lesson: Lesson) {
  return `${lesson.fromProblemSet ? "题单 " : ""}${lesson.problems.length} 道`
}

// ---------- 时间轴（只在今天以内） ----------

function hourOf(value: string) {
  const p = zonedParts(value)!
  return p.hour + p.minute / 60
}

/** 横轴默认 7 点到 20 点（机房上课的时段），有更早更晚的课就往外扩 */
const axis = computed(() => {
  const list = props.data.lessons
  const start = Math.min(7, ...list.map((item) => Math.floor(hourOf(item.start))))
  const end = Math.max(20, ...list.map((item) => Math.ceil(hourOf(item.end))))
  const ticks = []
  for (let hour = start + (start % 2); hour <= end; hour += 2) ticks.push(hour)
  return { start, end, ticks }
})

function axisLeft(hour: number) {
  const { start, end } = axis.value
  return `${((hour - start) / (end - start)) * 100}%`
}

function barStyle(lesson: Lesson) {
  const from = hourOf(lesson.start)
  const to = hourOf(lesson.end)
  const { start, end } = axis.value
  return {
    left: axisLeft(from),
    width: `max(6px, ${((to - from) / (end - start)) * 100}%)`,
    background: lesson.live ? theme.value.successColor : "#3f5f87",
  }
}

const nowHour = computed(() => {
  const hour = hourOf(new Date().toISOString())
  return hour >= axis.value.start && hour <= axis.value.end ? hour : null
})

function percent(value: number, total: number) {
  return total ? `${(value / total) * 100}%` : "0"
}
</script>

<template>
  <div class="lessons">
    <div
      v-if="liveLessons.length"
      class="live"
      :style="{ background: tone('success').background, color: tone('success').color }"
    >
      <span>{{ liveLessons.map((item) => classLabel(item.className)).join("、") }}正在上课</span>
      <span class="spacer"></span>
      <a href="#" class="live-link" @click.prevent="router.push('/classroom')">
        <Icon icon="ph:monitor" :width="14" />去课堂看板
      </a>
    </div>

    <div v-if="!lessonCount && !data.scattered.length" class="empty">这段时间没有人交</div>
    <div v-else-if="!lessonCount" class="note">
      这段时间没有哪个班一起上课（同一个班 5 人以上做同一道题才算一节课），只有零散提交
    </div>

    <template v-for="group in days" :key="group.day">
      <div class="day">{{ group.label }}</div>
      <a
        v-for="lesson in group.lessons"
        :key="`${lesson.className}|${lesson.start}`"
        href="#"
        class="row"
        @click.prevent="emit('pick', lesson)"
      >
        <span class="c-time">{{ clock(lesson) }}</span>
        <span v-if="timeline" class="c-axis">
          <span
            v-for="tick in axis.ticks"
            :key="tick"
            class="grid"
            :style="{ left: axisLeft(tick) }"
          ></span>
          <span class="bar" :style="barStyle(lesson)"></span>
          <span v-if="nowHour !== null" class="now" :style="{ left: axisLeft(nowHour) }"></span>
        </span>
        <b class="c-class">{{ classLabel(lesson.className) }}</b>
        <span class="c-came">{{ attendance(lesson) }}</span>
        <span class="c-probs">{{ problemText(lesson) }}</span>
        <span class="c-rate">
          {{ lesson.total }} 次 ·
          {{ lesson.live ? "上课中" : `正确率 ${Math.round(lesson.correctRate)}%` }}
        </span>
        <span class="c-hard">
          <template v-if="lesson.hardest">
            <n-text depth="3">错得最多</n-text>
            <n-text depth="3" class="pid">{{ lesson.hardest.problemDisplayId }}</n-text>
            {{ lesson.hardest.problemTitle }}
            <span :style="{ color: tone('warning').color }"
              >· 没过 {{ lesson.hardest.failed }} 次</span
            >
          </template>
        </span>
        <span class="c-go">看这节课<Icon icon="ph:caret-right-bold" :width="12" /></span>
      </a>
      <div v-if="group.scattered.length" class="scattered">
        {{ group.lessons.length ? "另有零散提交：" : "零散提交：" }}
        <template v-for="(item, index) in group.scattered" :key="item.className ?? ''">
          <template v-if="index"> · </template>
          <a href="#" title="看这个班这一天的提交" @click.prevent="emit('scattered', item)"
            >{{ classLabel(item.className) }} {{ item.userCount }} 人 {{ item.total }} 次</a
          >
        </template>
      </div>
    </template>

    <div v-if="timeline && lessonCount" class="axis-row">
      <span class="c-time"></span>
      <span class="c-axis axis">
        <!-- 挨着「现在」的刻度不写，不然两个字叠在一起 -->
        <template v-for="tick in axis.ticks" :key="tick">
          <span
            v-if="nowHour === null || Math.abs(tick - nowHour) > 0.8"
            :style="{ left: axisLeft(tick) }"
          >
            {{ tick }}
          </span>
        </template>
        <span v-if="nowHour !== null" class="now-label" :style="{ left: axisLeft(nowHour) }">
          现在
        </span>
      </span>
    </div>

    <div v-if="data.hasMore" class="more">
      <n-button size="small" :loading="loadingMore" @click="emit('more')">
        更早的课（现在列了最近 {{ lessonCount }} 节）
      </n-button>
    </div>

    <template v-if="data.hardProblems.length">
      <div class="section-title">
        <b>错得最多的题</b>
        <n-text depth="3" class="small">按没过的次数 · 点题目看各班做得怎样</n-text>
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
          <tr v-for="item in data.hardProblems" :key="item.problemDisplayId">
            <td class="hard-title">
              <a href="#" @click.prevent="emit('problem', item.problemDisplayId)">
                <n-text depth="3">{{ item.problemDisplayId }}</n-text> {{ item.problemTitle }}
              </a>
            </td>
            <td>
              <n-text depth="2">{{ classLabel(item.className) }}</n-text>
            </td>
            <td>{{ item.total }} 次</td>
            <td>
              <span class="mini">
                <span
                  :style="{ width: percent(item.accepted, item.total), background: resultColor(0) }"
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
              <n-text v-if="item.failures[0]" depth="2" class="small">
                {{ resultName(item.failures[0].result) }} {{ item.failures[0].count }}
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
  </div>
</template>

<style scoped>
.lessons {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 20px;
  font-size: 14px;
}

.live {
  display: flex;
  align-items: center;
  margin: 12px 20px 4px;
  padding: 8px 14px;
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

.spacer {
  flex: 1 1 0;
}

.empty {
  padding: 48px 0;
  text-align: center;
  color: v-bind("theme.textColor3");
}

.note {
  padding: 16px 20px 4px;
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.day {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 28px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-size: 12px;
  font-weight: 600;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.row {
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  color: v-bind("theme.textColor1");
  text-decoration: none;
  white-space: nowrap;
}

.row:hover {
  background: v-bind("theme.hoverColor");
}

.c-time {
  width: 110px;
  flex: none;
  color: v-bind("theme.textColor2");
  font-variant-numeric: tabular-nums;
}

.c-axis {
  position: relative;
  width: 200px;
  height: 28px;
  flex: none;
  margin-right: 20px;
}

.c-class {
  width: 120px;
  flex: none;
}

.c-came,
.c-probs {
  width: 96px;
  flex: none;
  color: v-bind("theme.textColor2");
}

.c-rate {
  width: 170px;
  flex: none;
  color: v-bind("theme.textColor2");
}

.c-hard {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}

.pid {
  margin-left: 10px;
}

.c-go {
  flex: none;
  margin-left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: v-bind("theme.primaryColor");
}

.grid {
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 1px;
  background: v-bind("theme.dividerColor");
}

.bar {
  position: absolute;
  top: 50%;
  height: 12px;
  margin-top: -6px;
  border-radius: 3px;
}

.now {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: v-bind("theme.successColor");
}

.axis-row {
  display: flex;
  padding: 0 20px;
  height: 20px;
}

.axis-row .c-axis {
  height: 20px;
}

.axis span {
  position: absolute;
  top: 3px;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 11px;
  color: v-bind("theme.textColor3");
}

.axis .now-label {
  font-weight: 600;
  color: v-bind("theme.successColor");
  background: v-bind("theme.cardColor");
  padding: 0 2px;
}

.scattered {
  padding: 7px 20px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.scattered a {
  color: v-bind("theme.textColor2");
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

.scattered a:hover {
  color: v-bind("theme.primaryColor");
}

.more {
  padding: 12px 20px 0;
}

.section-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 18px 20px 6px;
}

.small {
  font-size: 13px;
}

.hard {
  width: calc(100% - 40px);
  margin: 0 20px;
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

/* 1366 以下（机房 1280）：横条窄一点，给「错得最多」留地方 */
@media (max-width: 1365px) {
  .c-axis {
    width: 150px;
    margin-right: 14px;
  }
  .c-rate {
    width: 150px;
  }
}

/* 手机：老师很少在手机上看统计，只保证不坏 —— 一行折成两行 */
@media (max-width: 767px) {
  .row {
    height: auto;
    flex-wrap: wrap;
    row-gap: 4px;
    padding: 8px 14px;
    white-space: normal;
  }
  .c-axis,
  .axis-row {
    display: none;
  }
  .c-hard {
    flex-basis: 100%;
  }
  .hard {
    display: block;
    overflow-x: auto;
  }
}
</style>
