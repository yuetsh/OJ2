<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { onKeyStroke } from "@vueuse/core"
import { useThemeVars } from "naive-ui"
import { adminRejudge, getSubmission } from "oj/api"
import LockNote from "oj/problemset/components/LockNote.vue"
import WrongAnswerExplain from "oj/problem/components/WrongAnswerExplain.vue"
import UserName from "shared/components/UserName.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import { errorCode } from "utils/api"
import {
  JUDGE_STATUS,
  LANGUAGE_FORMAT_VALUE,
  LANGUAGE_SHOW_VALUE,
  SubmissionStatus,
} from "utils/constants"
import { parseTime, submissionCaseResults } from "utils/functions"
import type { Submission } from "utils/types"
import CodeView from "./components/CodeView.vue"
import ExplainNote from "./components/ExplainNote.vue"
import StatusPill from "./components/StatusPill.vue"
import { useCopySubmission } from "./composables/copySubmission"
import { useSubmissionExplain } from "./composables/explain"
import { useTone } from "./composables/tone"
import { classLabel, submissionTimeText } from "./utils"

/**
 * 单独打开的一条提交（设计稿「提交详情重设计」A，用户改成代码在前、例子在后）：一栏到底 ——
 * 名字和题目、结果、这道题交的几次（横排一串，← → 一次次翻）、代码、为什么错。
 * 原来是 B（左代码右说明），右栏占掉 540px，机房屏上代码框只剩 640px 宽，一成的
 * C 代码最长那行有 80 列，得左右滚。一栏到底代码占满整宽，字号不用缩。
 *
 * 入口是提交列表右栏的「新页面打开」、统计页的方块、后台卡点分析 —— 多半是老师在看某个学生
 * 怎么一次次改对的。
 */
const props = defineProps<{ submissionID: string }>()

const router = useRouter()
const message = useMessage()
const theme = useThemeVars()
const isDark = useDark()
const tone = useTone()
const userStore = useUserStore()
const { isMobile } = useBreakpoints()
const { copyToCat, copyToProblem } = useCopySubmission()

const detail = ref<Submission | null>(null)
/** forbidden：别人的代码；missing：链接不对 / 已删掉 */
const state = ref<"loading" | "ok" | "forbidden" | "missing" | "failed">("loading")

const judging = computed(
  () =>
    detail.value?.result === SubmissionStatus.pending ||
    detail.value?.result === SubmissionStatus.judging,
)

// 还在判的每 2 秒拉一次：这一页不在提交列表的轮询里，刚交完或刚重判时不刷新就一直是「等待评分」
let timer: ReturnType<typeof setTimeout> | undefined
// 翻得快的时候，晚回来的上一条不能盖掉这一条
let loadSeq = 0

async function load(quiet = false) {
  const seq = ++loadSeq
  clearTimeout(timer)
  if (!quiet) state.value = "loading"
  try {
    const res = await getSubmission(props.submissionID, true)
    if (seq !== loadSeq) return
    detail.value = res
    state.value = "ok"
    if (judging.value) timer = setTimeout(() => load(true), 2000)
  } catch (err) {
    if (seq !== loadSeq) return
    const code = errorCode(err)
    state.value =
      code === "submission-forbidden"
        ? "forbidden"
        : code === "submission-not-found"
          ? "missing"
          : "failed"
  }
}

watch(
  () => props.submissionID,
  () => load(),
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(timer))

const shown = computed(() => (state.value === "ok" ? detail.value : null))
const own = computed(() => !!shown.value && shown.value.userId === userStore.user?.id)
const teacher = computed(() => userStore.isTeacherOrAbove)
const who = computed(() => (own.value ? "你" : "他"))

const { explain, explainTone } = useSubmissionExplain(shown)

/** 答案错误、后端在例子上对比过：摆出输入 / 正确输出 / 他的输出（和题目页结果区同一块） */
const sampleCheck = computed(() => {
  const s = shown.value
  if (!s?.showLink || s.result !== SubmissionStatus.wrong_answer) return null
  return s.statisticInfo?.sample_check ?? null
})

/** 逐个测试点。只有管理员拿得到 info，学生只有 caseSummary 两个数 */
const cases = computed(() => submissionCaseResults(shown.value?.info))

function caseColor(result: number) {
  if (result === SubmissionStatus.accepted) return tone("success").solid
  if (result === SubmissionStatus.runtime_error) return tone("warning").solid
  return tone("error").solid
}

function caseTitle(item: (typeof cases.value)[number], index: number) {
  const name = JUDGE_STATUS[item.result as keyof typeof JUDGE_STATUS]?.name ?? ""
  const memory = item.memory === undefined ? "" : ` · ${(item.memory / 1048576).toFixed(1)}MB`
  const time = item.real_time === undefined ? "" : ` · ${item.real_time}ms`
  return `测试点 ${index + 1}：${name}${time}${memory}`
}

const attempts = computed(() => shown.value?.attempts ?? [])
const attemptIndex = computed(() => attempts.value.findIndex((a) => a.id === shown.value?.id))

/** 和正在看的这次同一天的只写钟点（一节课里连交好几次是常态），别的天带上日期 */
function attemptTime(time: string) {
  const current = shown.value?.createTime
  if (current && parseTime(time, "YYYY-MM-DD") === parseTime(current, "YYYY-MM-DD"))
    return parseTime(time, "HH:mm:ss")
  return submissionTimeText(time)
}

/** 除了正在看的这次，还有别的能点开的才提 ← → */
const canStep = computed(() =>
  attempts.value.some((item) => item.showLink && item.id !== shown.value?.id),
)

/** 「← →」一次次往前往后翻，跳过题单藏着的那几次 */
function step(delta: -1 | 1) {
  const list = attempts.value
  for (let i = attemptIndex.value + delta; i >= 0 && i < list.length; i += delta) {
    if (list[i]!.showLink) return openAttempt(list[i]!.id)
  }
}

function openAttempt(id: string) {
  if (id !== shown.value?.id) router.replace("/submission/" + id)
}

function typing(event: KeyboardEvent) {
  const el = event.target as HTMLElement | null
  return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)
}

// 这几次是横着排的一串，所以用 ← →（竖着排的列表才用 ↑ ↓，见提交列表）
onKeyStroke(["ArrowLeft", "ArrowRight"], (event) => {
  if (typing(event) || event.altKey || event.ctrlKey || event.metaKey || attempts.value.length < 2)
    return
  event.preventDefault()
  step(event.key === "ArrowLeft" ? -1 : 1)
})

const problemLink = computed(() => {
  const s = shown.value
  if (!s) return "/"
  if (s.contestId) {
    return router.resolve({
      name: "contest problem",
      params: { contestID: String(s.contestId), problemID: s.problemDisplayId },
    }).href
  }
  return "/problem/" + s.problemDisplayId
})

const allSubmissionsLink = computed(() => {
  const s = shown.value
  if (!s) return "/submission"
  return router.resolve({
    name: "submissions",
    query: { username: s.username, exactUsername: "1" },
  }).href
})

const canRejudge = computed(() => teacher.value && !!shown.value && !shown.value.contestId)

/** 老师的「⋯」：和提交列表右栏一样，复制两项 + 重新判题 */
const moreOptions = computed(() => {
  const s = shown.value
  if (!s) return []
  const copy = s.showLink
    ? [
        { label: "复制回到题目", key: "problem" },
        ...(s.language !== "SQL" ? [{ label: "复制到自测猫", key: "cat" }] : []),
      ]
    : []
  // 手机上名字、班级和这个按钮排不进一行，收进「⋯」
  const all = !own.value && isMobile.value ? [{ label: "他的全部提交", key: "all" }] : []
  if (!canRejudge.value) return [...all, ...copy]
  return [
    ...all,
    ...copy,
    ...(copy.length ? [{ type: "divider", key: "divider" }] : []),
    { label: "重新判题", key: "rejudge" },
  ]
})

async function rejudge() {
  const s = shown.value
  if (!s) return
  try {
    await adminRejudge(s.id)
  } catch {
    message.error("重新判题没成功")
    return
  }
  message.success("已重新判题，结果出来会自己更新")
  load(true)
}

function handleMore(key: string) {
  const s = shown.value
  if (!s) return
  if (key === "all") router.push(allSubmissionsLink.value)
  else if (key === "rejudge") rejudge()
  else if (key === "problem") copyToProblem(s)
  else copyToCat(s)
}
</script>

<template>
  <div class="oj-page detail" :class="{ narrow: isMobile }">
    <template v-if="shown">
      <div class="head">
        <div class="who">
          <a
            class="user-link"
            :href="`/user?name=${encodeURIComponent(shown.username)}`"
            target="_blank"
          >
            <UserName :username="shown.username" />
          </a>
          <span v-if="teacher && shown.className" class="cls">
            {{ classLabel(shown.className) }}
          </span>
        </div>
        <span v-if="!isMobile" class="dot">·</span>
        <a
          class="problem"
          :href="problemLink"
          :title="`${shown.problemDisplayId} ${shown.problemTitle}`"
        >
          <span class="problem-id">{{ shown.problemDisplayId }}</span>
          {{ shown.problemTitle }}
        </a>
        <a
          v-if="shown.problemSet"
          class="problemset"
          :href="'/problemset/' + shown.problemSet.id"
          :title="'从题单「' + shown.problemSet.title + '」交的'"
        >
          题单 {{ shown.problemSet.title }}
        </a>
        <div class="spacer"></div>
        <div class="actions">
          <template v-if="teacher">
            <n-button v-if="!own && !isMobile" tag="a" :href="allSubmissionsLink">
              他的全部提交
            </n-button>
            <n-dropdown
              v-if="moreOptions.length"
              :options="moreOptions"
              trigger="click"
              placement="bottom-end"
              @select="handleMore"
            >
              <n-button quaternary aria-label="更多" title="复制、重新判题">
                <template #icon><Icon icon="ph:dots-three-bold" /></template>
              </n-button>
            </n-dropdown>
          </template>
          <template v-else-if="shown.showLink">
            <n-button type="primary" @click="copyToProblem(shown)">
              <template #icon><Icon icon="ph:arrow-u-up-left" /></template>
              复制回到题目
            </n-button>
            <n-button v-if="shown.language !== 'SQL'" @click="copyToCat(shown)"
              >复制到自测猫</n-button
            >
          </template>
        </div>
      </div>

      <div class="meta">
        <StatusPill :result="shown.result" />
        <span v-if="cases.length" class="cases">
          <span
            v-for="(item, index) in cases"
            :key="index"
            class="case"
            :style="{ background: caseColor(item.result), color: isDark ? '#18181c' : '#ffffff' }"
            :title="caseTitle(item, index)"
          >
            {{ index + 1 }}
          </span>
        </span>
        <span
          v-else-if="shown.caseSummary && shown.caseSummary.passed < shown.caseSummary.total"
          class="partial"
          :style="{ color: tone('error').color }"
        >
          通过 {{ shown.caseSummary.passed }}/{{ shown.caseSummary.total }} 个测试点
        </span>
        <span>{{ LANGUAGE_SHOW_VALUE[shown.language] }}</span>
        <span>{{ submissionTimeText(shown.createTime, true) }}</span>
        <span v-if="attemptIndex >= 0 && attempts.length > 1"
          >第 {{ attemptIndex + 1 }} 次提交</span
        >
      </div>

      <section v-if="attempts.length > 1" class="attempts">
        <span class="attempts-title">{{ who }}这道题交了 {{ attempts.length }} 次</span>
        <a
          v-for="(item, index) in attempts"
          :key="item.id"
          :href="item.showLink ? '/submission/' + item.id : undefined"
          class="attempt"
          :class="{ on: item.id === shown.id, off: !item.showLink }"
          :title="`第 ${index + 1} 次`"
          @click.prevent="item.showLink && openAttempt(item.id)"
        >
          <Icon v-if="!item.showLink" icon="ph:lock-simple" class="muted" />
          <StatusPill v-else :result="item.result" bare />
          <span class="t">{{ attemptTime(item.createTime) }}</span>
        </a>
        <span v-if="!isMobile && canStep" class="keys"><kbd>←</kbd><kbd>→</kbd> 换一次</span>
      </section>

      <div v-if="!shown.showLink" class="locked">
        <Icon icon="ph:lock-simple" :width="30" class="lock-icon" />
        <span class="locked-title">这份代码在题单布置期内先藏着</span>
        <span class="muted"><LockNote :problem="{ displayId: shown.problemDisplayId }" /></span>
      </div>
      <CodeView
        v-else
        :code="shown.code"
        :language="LANGUAGE_FORMAT_VALUE[shown.language]"
        :mark-line="explain?.line ?? null"
        :font-size="isMobile ? 14 : 18"
        :line-height="isMobile ? 24 : 30"
        class="code"
      />

      <WrongAnswerExplain
        v-if="sampleCheck"
        :check="sampleCheck"
        :code="shown.code"
        :language="shown.language"
        :plain="!!shown.contestId"
        :peer="!own"
      />
      <ExplainNote v-else-if="explain" :explain="explain" :tone="explainTone" />
    </template>

    <div v-else-if="state === 'loading'" class="center">
      <n-spin />
    </div>

    <div v-else class="locked full">
      <Icon icon="ph:lock-simple" :width="34" class="lock-icon" />
      <template v-if="state === 'forbidden'">
        <span class="locked-title">别人的代码看不到</span>
        <span class="muted">自己动手做出来，才是自己的。</span>
      </template>
      <template v-else-if="state === 'missing'">
        <span class="locked-title">这条提交不存在</span>
        <span class="muted">可能是链接复制错了，或者它已经被删掉。</span>
      </template>
      <template v-else>
        <span class="locked-title">没拉下来</span>
        <n-button @click="load()">再试一次</n-button>
      </template>
      <n-button v-if="state !== 'failed'" tag="a" href="/submission">去提交列表</n-button>
    </div>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
  font-size: 18px;
  min-width: 0;
}

.who {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.user-link {
  display: flex;
  text-decoration: none;
}

.user-link:hover :deep(.name) {
  color: v-bind("theme.primaryColor");
}

.cls {
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  color: v-bind("tone('success').color");
  border: 1px solid v-bind("tone('success').background");
}

.dot {
  color: v-bind("theme.textColor3");
}

.problem {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.problem:hover {
  color: v-bind("theme.primaryColor");
}

.problem-id {
  color: v-bind("theme.textColor3");
  font-weight: 400;
}

.problemset {
  flex: none;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: v-bind("tone('info').color");
  background: v-bind("tone('info').background");
}

.spacer {
  flex: 1 1 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.meta {
  display: flex;
  align-items: center;
  gap: 14px;
  row-gap: 6px;
  flex-wrap: wrap;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}

.cases {
  display: inline-flex;
  gap: 4px;
}

.case {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.partial {
  font-weight: 600;
}

/* 这道题交的几次：横排一串，点哪次换哪次（设计稿 A） */
.attempts {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.attempts-title {
  margin-right: 4px;
  font-size: 14px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}

.attempt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  box-sizing: border-box;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 16px;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  text-decoration: none;
  white-space: nowrap;
}

.attempt:hover {
  background: v-bind("theme.hoverColor");
}

.attempt.on {
  border-color: v-bind("theme.successColor");
  background: v-bind("tone('success').background");
  color: v-bind("theme.textColor1");
  font-weight: 600;
}

.attempt.off {
  cursor: default;
  opacity: 0.6;
}

.attempt .t {
  font-variant-numeric: tabular-nums;
}

.keys {
  margin-left: auto;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

kbd {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  box-sizing: border-box;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 3px;
  background: v-bind("theme.cardColor");
  font: inherit;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* 代码占满整宽、有多长画多长，不在框里上下滚（CodeView 自己默认是撑满父级的 flex 子项） */
.detail .code {
  flex: none;
}

.muted {
  color: v-bind("theme.textColor3");
}

.locked {
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  text-align: center;
  border: 1px dashed v-bind("theme.borderColor");
  border-radius: 8px;
  background: v-bind("theme.cardColor");
}

.locked.full {
  min-height: 320px;
}

.lock-icon {
  color: v-bind("theme.textColor3");
  opacity: 0.7;
}

.locked-title {
  font-size: 17px;
  font-weight: 600;
}

.center {
  min-height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 手机：顺序和桌面一样，只是名字、题目一行排不下要折行 */
.narrow .head {
  flex-wrap: wrap;
  white-space: normal;
  font-size: 16px;
  row-gap: 6px;
}

.narrow .problem {
  flex-basis: 100%;
  order: 3;
  white-space: normal;
}

.narrow .problemset {
  order: 4;
}

.narrow .actions {
  order: 2;
}
</style>
