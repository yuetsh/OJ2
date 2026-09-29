<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { getProblemStats } from "oj/api"
import { useContestStore } from "oj/store/contest"
import { useProblemStore } from "oj/store/problem"
import { useTone, type Tone } from "oj/submission/composables/tone"
import { classLabel, submissionDayText } from "oj/submission/utils"
import { DIFFICULTY, JUDGE_STATUS } from "utils/constants"
import { getTagColor, parseTime } from "utils/functions"
import type { ProblemStats, SUBMISSION_RESULT } from "utils/types"
import { useProblemPageContext } from "../composables/problemPageContext"

/**
 * 「统计」页签（设计稿「题目页统计重设计」学生 A）。讲的是**这道题**：难不难 → 大家几次
 * 做对 → 常错在哪，全部按人算。学生多一行「你们班」、自己卡住了再多一张卡；老师多一张
 * 各班的表（只到班级这一层，不选班、不列人 —— 按人看是提交页「数据统计」的活）。
 * 原来的描述表、击败用户、饼图、历年 AC 率都去掉了。
 */
const emit = defineEmits<{ openSubmissions: [] }>()

const { problem } = storeToRefs(useProblemStore())
const contestStore = useContestStore()
const ctx = useProblemPageContext()
const route = useRoute()
const router = useRouter()
const theme = useThemeVars()
const tone = useTone()

const stats = ref<ProblemStats | null>(null)
const failed = ref(false)

async function load() {
  if (!problem.value) return
  failed.value = false
  try {
    stats.value = await getProblemStats(problem.value.id)
  } catch {
    failed.value = true
  }
}

onMounted(load)

function resultName(result: number) {
  return JUDGE_STATUS[result as SUBMISSION_RESULT]?.name ?? "其他"
}

function resultTone(result: number): Tone {
  return JUDGE_STATUS[result as SUBMISSION_RESULT]?.type ?? "default"
}

/** 条的颜色：运行时错误橙、答案错误红、编译失败灰 —— 和提交列表的胶囊一个配色 */
function barColor(result: number) {
  const kind = resultTone(result)
  // 编译失败用灰：它和运行时错误都是 warning，都画成橙色就分不开了
  if (result === -2 || kind === "default" || kind === "info") return theme.value.textColor3
  return tone(kind).color
}

// ---------- 学生 ----------

const verdict = computed(() => {
  const s = stats.value
  if (!s || !s.tried) return null
  const rate = s.solved / s.tried
  const firstShare = s.solved ? s.tries.one / s.solved : 0
  const manyShare = s.solved ? s.tries.many / s.solved : 0
  const detail = `${s.tried} 人做过，${s.solved} 人做对了`
  if (rate >= 0.9 && firstShare >= 0.6) {
    return { kind: "success" as const, text: "这题不难：大多数人第一次交就对了", detail }
  }
  if (problem.value?.difficulty === "Low" && (rate < 0.9 || manyShare >= 0.15)) {
    return { kind: "warning" as const, text: "标的是「简单」，但不少人卡住了", detail }
  }
  if (rate >= 0.75) {
    return { kind: "info" as const, text: "多数人做对了，不少人要多试几次", detail }
  }
  return { kind: "warning" as const, text: "这题有点难：不少人还没做对", detail }
})

const triesSegments = computed(() => {
  const s = stats.value
  if (!s) return []
  const green = theme.value.successColor
  return [
    { key: "one", label: "1 次", value: s.tries.one, color: green, opacity: 1 },
    { key: "few", label: "2–3 次", value: s.tries.few, color: green, opacity: 0.6 },
    { key: "many", label: "4 次以上", value: s.tries.many, color: green, opacity: 0.3 },
    {
      key: "none",
      label: "没做对",
      value: s.tried - s.solved,
      color: theme.value.dividerColor,
      opacity: 1,
    },
  ]
})

const failedTotal = computed(() =>
  (stats.value?.failures ?? []).reduce((sum, item) => sum + item.count, 0),
)
const topFailures = computed(() => (stats.value?.failures ?? []).slice(0, 3))

/** 错得最多的那一种，给一句该怎么办。都指向「运行例子」：提交前自己就能看出来 */
const tip = computed(() => {
  const s = stats.value
  const top = s?.failures[0]
  if (!s || !top) return ""
  if (top.result === -1) {
    return s.wrongAnswerFirstCase >= top.count * 0.6
      ? "答案错误几乎都卡在第 1 个测试点：多半是例子都没对上。先点「运行例子」，把你的输出和例子一行一行对一对。"
      : "答案错误最多：输出和标准答案对不上。留意空格、换行和标点，交之前先点「运行例子」对一对。"
  }
  if (top.result === 4) {
    return "运行时错误最多：程序跑到一半出错了。交之前先点「运行例子」，看看有没有红色的报错。"
  }
  if (top.result === -2) {
    return "编译失败最多：代码有语法错误，程序根本没跑起来。交之前先点「运行例子」检查一下。"
  }
  return ""
})

/** 自己交了好几次还没对：比赛里没有举手，也不提「看别人」 */
const stuck = computed(() => {
  const me = stats.value?.me
  return me && !me.solved && me.attempts >= 3 ? me.attempts : 0
})

// ---------- 老师：各班的表 ----------

/** 班多的老题（1001 这种十几个班都做过）先给 6 个，交过的人多的在前 */
const allClasses = ref(false)
const shownClasses = computed(() =>
  allClasses.value ? (stats.value?.classes ?? []) : (stats.value?.classes ?? []).slice(0, 6),
)
const hiddenClasses = computed(
  () => (stats.value?.classes?.length ?? 0) - shownClasses.value.length,
)

/** 点一个班、或者表下面那行：去提交页的「数据统计」按人看（新标签，题目页不动） */
function openStatistics(className?: string) {
  const href = router.resolve({
    name: "statistics",
    query: { problem: problem.value!._id, period: "all", ...(className ? { className } : {}) },
  }).href
  window.open(href, "_blank")
}

function segmentWidth(value: number, total: number) {
  return total ? `${(value / total) * 100}%` : "0"
}
</script>

<template>
  <div v-if="problem" class="info">
    <!-- 原来占一大块的描述表收成一行 -->
    <div class="meta">
      <b class="meta-title">{{ problem._id }} {{ problem.title }}</b>
      <!-- 比赛进行中难度不下发（null），整个不显示 -->
      <n-tag
        v-if="problem.difficulty"
        size="small"
        round
        :bordered="false"
        :type="getTagColor(problem.difficulty)"
      >
        {{ DIFFICULTY[problem.difficulty] }}
      </n-tag>
      <n-tag
        v-for="tag in problem.tags"
        :key="tag"
        size="small"
        round
        :bordered="false"
        type="info"
      >
        {{ tag }}
      </n-tag>
      <span class="spacer"></span>
      <n-text depth="3" class="meta-author">{{ problem.createdBy.username }} 出题</n-text>
    </div>

    <n-text v-if="failed" type="error">统计没拉下来，关掉再打开试试</n-text>
    <div v-else-if="!stats" class="center"><n-spin size="small" /></div>

    <!-- 比赛进行中：别人的情况等比赛结束再公布 -->
    <div v-else-if="stats.locked" class="empty">
      <span class="empty-icon"><Icon icon="ph:lock-simple" :width="18" /></span>
      <b>比赛结束后才能看到大家的情况</b>
      <n-text depth="3">
        <template v-if="contestStore.contest">
          比赛 {{ parseTime(contestStore.contest.endTime, "HH:mm") }} 结束。
        </template>
        现在只看得到你自己的提交，别人几次做对、错在哪，结束后一起公布。
      </n-text>
      <router-link
        :to="{ name: 'contest rank', params: { contestID: route.params.contestID } }"
        class="link"
      >
        去看比赛排名 ›
      </router-link>
    </div>

    <!-- ==================== 这道题（学生、老师都看） ==================== -->
    <div v-else-if="!stats.tried" class="empty">
      <span class="empty-icon"><Icon icon="ph:sparkle" :width="18" /></span>
      <b>还没有人交过这道题</b>
      <n-text depth="3">你可以做第一个。</n-text>
    </div>
    <template v-else>
      <div
        v-if="verdict"
        class="verdict"
        :style="{
          background: tone(verdict.kind).background,
          borderColor: tone(verdict.kind).background,
        }"
      >
        <b :style="{ color: tone(verdict.kind).color }">
          <Icon icon="ph:gauge" :width="16" />{{ verdict.text }}
        </b>
        <n-text depth="2" class="small">{{ verdict.detail }}</n-text>
      </div>

      <div v-if="stats.solved" class="section">
        <div class="line">
          <b>做对用了几次</b>
          <span class="spacer"></span>
          <n-text depth="3" class="small">按人算</n-text>
        </div>
        <div class="bar">
          <span
            v-for="seg in triesSegments"
            :key="seg.key"
            :style="{
              width: segmentWidth(seg.value, stats.tried),
              background: seg.color,
              opacity: seg.opacity,
            }"
          ></span>
        </div>
        <div class="legend">
          <span v-for="seg in triesSegments" :key="seg.key">
            <i :style="{ background: seg.color, opacity: seg.opacity }"></i>{{ seg.label }}
            <b>{{ seg.value }}</b>
          </span>
        </div>
      </div>

      <div v-if="topFailures.length" class="section">
        <b>没通过的 {{ failedTotal }} 次，错在哪</b>
        <div v-for="item in topFailures" :key="item.result" class="fail">
          <span class="fail-name">{{ resultName(item.result) }}</span>
          <span class="fail-track">
            <span
              :style="{
                width: segmentWidth(item.count, topFailures[0]!.count),
                background: barColor(item.result),
              }"
            ></span>
          </span>
          <span class="fail-count">{{ item.count }} 次</span>
        </div>
        <div
          v-if="tip"
          class="tip"
          :style="{ background: tone('warning').background, color: tone('warning').color }"
        >
          <Icon icon="ph:lightbulb" :width="15" class="tip-icon" />
          <span>{{ tip }}</span>
        </div>
      </div>

      <!-- 老师：各班一行，和数据统计「按班级汇总」同一份数；按人看去那边 -->
      <div v-if="stats.classes?.length" class="section">
        <b>各班做得怎样</b>
        <table class="classes">
          <thead>
            <tr>
              <th>班级</th>
              <th>做完</th>
              <th>交了没对</th>
              <th>没交</th>
              <th>正确率</th>
              <th>最近一次</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in shownClasses"
              :key="item.className ?? ''"
              :class="{ pickable: item.className }"
              :title="item.className ? '去数据统计看这个班的每个人' : undefined"
              @click="item.className && openStatistics(item.className)"
            >
              <td>
                <b>{{ item.className ? classLabel(item.className) : "没有班级" }}</b>
              </td>
              <td>
                <span class="done-bar">
                  <span
                    :style="{
                      width: segmentWidth(item.solved, item.classSize),
                      background: theme.successColor,
                    }"
                  ></span>
                </span>
                {{ item.solved }}/{{ item.classSize }}
              </td>
              <td :style="{ color: item.unsolved ? tone('warning').color : undefined }">
                {{ item.unsolved }}
              </td>
              <td :style="{ color: item.untouched ? tone('error').color : undefined }">
                {{ item.untouched }}
              </td>
              <td>
                <n-text depth="2">{{
                  item.correctRate === null ? "—" : `${item.correctRate}%`
                }}</n-text>
              </td>
              <td>
                <n-text depth="2">{{ submissionDayText(item.lastTime) }}</n-text>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="foot">
          <a v-if="hiddenClasses" href="#" class="link small" @click.prevent="allClasses = true">
            还有 {{ hiddenClasses }} 个班 ›
          </a>
          <span class="spacer"></span>
          <a href="#" class="link small" @click.prevent="openStatistics()">
            按人看谁没做对，去数据统计 <Icon icon="ph:arrow-square-out" :width="13" />
          </a>
        </div>
      </div>

      <div v-if="stats.myClass?.tried" class="class-box">
        <div class="line">
          <b>你们班 · {{ classLabel(stats.myClass.className) }}</b>
          <span class="spacer"></span>
          <span>
            <b class="big">{{ stats.myClass.solved }}</b>
            <n-text depth="3"> / {{ stats.myClass.tried }} 人做对</n-text>
          </span>
        </div>
        <div class="bar thin">
          <span
            :style="{
              width: segmentWidth(stats.myClass.solved, stats.myClass.tried),
              background: theme.successColor,
            }"
          ></span>
        </div>
      </div>

      <div
        v-if="stuck && ctx.entry !== 'contest'"
        class="stuck"
        :style="{ borderColor: tone('warning').background, background: tone('warning').background }"
      >
        <b>你交了 {{ stuck }} 次，还没对上</b>
        <n-text depth="2" class="small">
          卡了这么久，可以点右上角「举手求助」问老师；也可以去「我的提交」看看每一次错在哪。
        </n-text>
        <div>
          <n-button size="small" @click="emit('openSubmissions')">看我的提交</n-button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.info {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 14px;
}

.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.meta-title {
  margin-right: 4px;
}

.meta-author,
.small {
  font-size: 13px;
}

.spacer {
  flex: 1 1 0;
}

.center {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.empty {
  padding: 60px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.empty-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor2");
  margin-bottom: 4px;
}

.link {
  color: v-bind("theme.primaryColor");
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
}

.verdict {
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.verdict b {
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.bar {
  height: 12px;
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  gap: 2px;
  background: v-bind("theme.dividerColor");
}

.bar.thin {
  height: 8px;
}

.bar > span {
  height: 100%;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 5px;
  vertical-align: -1px;
}

.fail {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.fail-name {
  width: 72px;
  flex: none;
}

.fail-track {
  flex: 1;
  height: 10px;
  border-radius: 5px;
  background: v-bind("theme.actionColor");
  overflow: hidden;
}

.fail-track > span {
  display: block;
  height: 100%;
  border-radius: 5px;
}

.fail-count {
  width: 48px;
  flex: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.tip {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.6;
}

.tip-icon {
  flex: none;
  margin-top: 3px;
}

.class-box {
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid v-bind("theme.dividerColor");
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.big {
  font-size: 18px;
  color: v-bind("theme.successColor");
}

.stuck {
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.foot {
  display: flex;
  justify-content: flex-end;
}

.classes {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.classes th {
  white-space: nowrap;
  text-align: left;
  font-weight: normal;
  color: v-bind("theme.textColor3");
  padding: 4px 8px 6px 0;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.classes td {
  padding: 8px 8px 8px 0;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  white-space: nowrap;
}

.classes tbody tr.pickable {
  cursor: pointer;
}

.done-bar {
  display: inline-flex;
  width: 60px;
  height: 6px;
  margin-right: 6px;
  border-radius: 3px;
  overflow: hidden;
  vertical-align: middle;
  background: v-bind("theme.dividerColor");
}

.classes tbody tr.pickable:hover {
  background: v-bind("theme.hoverColor");
}
</style>
