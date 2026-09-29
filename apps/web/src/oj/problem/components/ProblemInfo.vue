<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { getProblemStats } from "oj/api"
import { useContestStore } from "oj/store/contest"
import { useProblemStore } from "oj/store/problem"
import { useTone, type Tone } from "oj/submission/composables/tone"
import { classLabel } from "oj/submission/utils"
import { DIFFICULTY, JUDGE_STATUS } from "utils/constants"
import { getTagColor, parseTime } from "utils/functions"
import type { ProblemStats, SUBMISSION_RESULT } from "utils/types"
import { useProblemPageContext } from "../composables/problemPageContext"

/**
 * 「统计」页签（设计稿「题目页统计重设计」：学生 A、老师 B）。
 *
 * 学生看的是「这题难不难 → 大家几次做对 → 常错在哪 → 你们班」，全部按人算；自己卡住了
 * 再多一张卡。老师看的是一个班：谁做对了、谁交了没对（卡在哪）、谁还没交 —— 原来工具栏上
 * 的「课堂统计」并进了这里。原来的描述表、击败用户、饼图、历年 AC 率都去掉了。
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
const className = ref<string | null>(null)

async function load() {
  if (!problem.value) return
  failed.value = false
  try {
    const res = await getProblemStats(problem.value.id, className.value ?? undefined)
    stats.value = res
    if (res.classDetail) className.value = res.classDetail.className
  } catch {
    failed.value = true
  }
}

onMounted(load)

function changeClass(value: string) {
  className.value = value
  load()
}

const teacherView = computed(() => stats.value?.classes != null)

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

// ---------- 老师 ----------

const detail = computed(() => stats.value?.classDetail ?? null)

const classOptions = computed(() =>
  (stats.value?.classes ?? []).map((item) => ({
    label: `${classLabel(item.className)} · ${item.solved}/${item.tried}`,
    value: item.className,
  })),
)

const classSegments = computed(() => {
  const d = detail.value
  if (!d) return []
  return [
    { key: "solved", label: "做对", value: d.solved.length, color: theme.value.successColor },
    { key: "unsolved", label: "交了没对", value: d.unsolved.length, color: theme.value.errorColor },
    { key: "untouched", label: "没交", value: d.untouched.length, color: theme.value.dividerColor },
  ]
})

const classFailedTotal = computed(() =>
  (detail.value?.failures ?? []).reduce((sum, item) => sum + item.count, 0),
)

/** 这个班错得最多的和全站不一样时点出来：老师该看的就是这种差别 */
const siteDiffers = computed(() => {
  const site = stats.value?.failures[0]
  const mine = detail.value?.failures[0]
  return site && mine && site.result !== mine.result ? resultName(site.result) : ""
})

const showSolved = ref(false)
const showUntouched = ref(false)

function openStatistics() {
  const href = router.resolve({
    name: "statistics",
    query: { problem: problem.value!._id, className: className.value ?? "", period: "all" },
  }).href
  window.open(href, "_blank")
}

function openClassSubmissions() {
  const href = router.resolve({
    name: "submissions",
    query: { problem: problem.value!._id, className: className.value ?? "" },
  }).href
  window.open(href, "_blank")
}

/** 「2025-12-05」→「2025年12月5日」。后端给的已经是东八区的日子，不用再换算 */
function dayText(day: string) {
  const [year, month, date] = day.split("-").map(Number)
  return `${year}年${month}月${date}日`
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

    <!-- ==================== 老师：看一个班 ==================== -->
    <template v-else-if="teacherView">
      <div v-if="!detail" class="empty">
        <span class="empty-icon"><Icon icon="ph:users" :width="18" /></span>
        <b>还没有班级做过这道题</b>
        <n-text depth="3">布置到这节课之后，这里会按班显示谁做对了、谁还没交。</n-text>
        <n-button type="primary" secondary @click="router.push('/classroom')">
          去课堂看板布置 →
        </n-button>
      </div>
      <template v-else>
        <div class="class-head">
          <n-select
            :value="className"
            :options="classOptions"
            size="small"
            class="class-select"
            :consistent-menu-width="false"
            @update:value="changeClass"
          />
          <n-text depth="3" class="small">{{ dayText(detail.day) }}做的</n-text>
          <span class="spacer"></span>
          <a href="#" class="link small" @click.prevent="openStatistics">
            在数据统计里看 <Icon icon="ph:arrow-square-out" :width="13" />
          </a>
        </div>

        <div class="bar">
          <span
            v-for="seg in classSegments"
            :key="seg.key"
            :style="{ width: segmentWidth(seg.value, detail.roster), background: seg.color }"
          ></span>
        </div>
        <div class="legend">
          <span v-for="seg in classSegments" :key="seg.key">
            <i :style="{ background: seg.color }"></i>{{ seg.label }} <b>{{ seg.value }}</b>
          </span>
        </div>

        <div v-if="classFailedTotal" class="line">
          <b>没通过的 {{ classFailedTotal }} 次：</b>
          <n-text depth="2">
            {{
              detail.failures
                .slice(0, 3)
                .map((item) => `${resultName(item.result)} ${item.count}`)
                .join(" · ")
            }}
          </n-text>
          <span class="spacer"></span>
          <n-text v-if="siteDiffers" depth="3" class="small">全站是{{ siteDiffers }}最多</n-text>
        </div>

        <template v-if="detail.unsolved.length">
          <div class="line">
            <b>交了没对（{{ detail.unsolved.length }} 人）</b>
            <span class="spacer"></span>
            <n-text depth="3" class="small">次数多的在前</n-text>
          </div>
          <div class="people">
            <div v-for="(item, index) in detail.unsolved" :key="index" class="person">
              <b>{{ item.realName }}</b>
              <n-text depth="3">{{ item.attempts }} 次</n-text>
              <span :style="{ color: barColor(item.lastResult) }">
                {{ resultName(item.lastResult) }}
              </span>
            </div>
          </div>
        </template>

        <div v-if="detail.solved.length" class="fold">
          <div class="fold-head" @click="showSolved = !showSolved">
            <b>做对 {{ detail.solved.length }}</b>
            <span class="fold-names">
              {{ showSolved ? "" : detail.solved.join("、") }}
            </span>
            <span class="link small">{{ showSolved ? "收起" : "展开" }}</span>
          </div>
          <div v-if="showSolved" class="fold-body">{{ detail.solved.join("、") }}</div>
        </div>
        <div v-if="detail.untouched.length" class="fold">
          <div class="fold-head" @click="showUntouched = !showUntouched">
            <b>没交 {{ detail.untouched.length }}</b>
            <span class="fold-names">{{ showUntouched ? "" : "展开看名单" }}</span>
            <span class="link small">{{ showUntouched ? "收起" : "展开" }}</span>
          </div>
          <div v-if="showUntouched" class="fold-body">{{ detail.untouched.join("、") }}</div>
        </div>

        <div class="foot">
          <a href="#" class="link small" @click.prevent="openClassSubmissions">
            看这个班这道题的提交 ›
          </a>
        </div>
      </template>
    </template>

    <!-- ==================== 学生 ==================== -->
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

.class-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.class-select {
  width: 190px;
}

.people {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px;
}

.person {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid v-bind("theme.dividerColor");
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
}

.fold {
  border-radius: 6px;
  background: v-bind("theme.actionColor");
  font-size: 13px;
}

.fold-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.fold-names {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: v-bind("theme.textColor2");
}

.fold-body {
  padding: 0 12px 10px;
  line-height: 1.8;
  color: v-bind("theme.textColor2");
}

.foot {
  display: flex;
  justify-content: flex-end;
}
</style>
