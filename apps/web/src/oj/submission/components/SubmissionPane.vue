<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { getSubmission } from "oj/api"
import { explainPythonCompileError } from "oj/problem/utils/pythonError"
import { explainRuntimeError } from "oj/problem/utils/runtimeError"
import { useUserStore } from "shared/store/user"
import {
  JUDGE_STATUS,
  LANGUAGE_FORMAT_VALUE,
  LANGUAGE_SHOW_VALUE,
  SubmissionStatus,
} from "utils/constants"
import {
  submissionCaseResults,
  submissionMemoryFormat,
  submissionTimeFormat,
} from "utils/functions"
import type { Submission, SubmissionListItem } from "utils/types"
import { useCopySubmission } from "../composables/copySubmission"
import { useTone } from "../composables/tone"
import { classLabel, submissionTimeText } from "../utils"
import CodeView from "./CodeView.vue"
import StatusPill from "./StatusPill.vue"
import UserName from "./UserName.vue"

/**
 * 提交列表的右栏：选中那一条的代码和结果（设计稿「提交列表重设计 · 定稿」）。
 * 原来要点开一个弹框看，老师翻全班代码时是「点开 → 看 → 关掉 → 点下一行」。
 */
const props = defineProps<{
  row: SubmissionListItem
  /** 老师那套：重新判题、逐个测试点、复制两项收进「⋯」 */
  teacher: boolean
  /** 在比赛的提交列表里（不能重判，题目链接走比赛） */
  contest: boolean
  /** 列表现在筛的班级：已经在筛这个班就不再给「只看这个班」 */
  className?: string
  /** 右下角的「本页第 i / n 条」 */
  position: { index: number; count: number } | null
  /** 手机上的整屏详情：头部折行、不提方向键 */
  narrow?: boolean
}>()

const emit = defineEmits<{
  filterUser: [username: string]
  filterClass: [className: string]
  filterProblem: [displayId: string]
  openProblem: [row: SubmissionListItem]
  rejudge: [id: string]
}>()

const userStore = useUserStore()
const theme = useThemeVars()
// 暗色下测试点方块的底色是主题色本身（浅），白字就看不清了
const isDark = useDark()
const tone = useTone()
const { copyToCat, copyToProblem } = useCopySubmission()

/**
 * 详情按提交 id 缓存：判完的代码和结果不会再变，老师在几行之间来回按方向键时不用每次都等网络。
 * 还在判的不进缓存；一条被重判（结果回到「等待评分」）就把它的缓存扔掉 —— 重判后结果
 * 可能没变（答案错误还是答案错误），但测试点和报错是新的
 */
const cache = new Map<string, Submission>()
const detail = ref<Submission | null>(null)
const loading = ref(false)
const failed = ref(false)

const judging = computed(
  () =>
    props.row.result === SubmissionStatus.pending || props.row.result === SubmissionStatus.judging,
)

// 每次加载一个序号：同一条先按「判题中」拉了一次、判完又拉一次时，晚回来的旧请求不能盖掉新的
let loadSeq = 0

async function load() {
  const row = props.row
  const seq = ++loadSeq
  failed.value = false
  if (judging.value) cache.delete(row.id)
  if (!row.showLink) {
    detail.value = null
    return
  }
  const hit = cache.get(row.id)
  if (hit && hit.result === row.result) {
    detail.value = hit
    return
  }
  loading.value = true
  try {
    const res = await getSubmission(row.id)
    if (seq !== loadSeq) return
    // 列表那边还在判、详情这边已经判完了（或反过来）都不缓存，等两边对上
    if (!judging.value && res.result === props.row.result) cache.set(row.id, res)
    detail.value = res
  } catch {
    if (seq === loadSeq) failed.value = true
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(() => [props.row.id, props.row.result, props.row.showLink] as const, load, {
  immediate: true,
})

const shown = computed(() => (detail.value?.id === props.row.id ? detail.value : null))

const locked = computed(() => {
  if (props.row.showLink) return null
  if (!userStore.isAuthed) return "anon" as const
  if (props.row.userId === userStore.user?.id) return "problemset" as const
  return "others" as const
})

/** 逐个测试点。只有管理员拿得到 info（每个点带 output_md5），学生只有 caseSummary 两个数 */
const cases = computed(() => submissionCaseResults(shown.value?.info))

function stripJudgePath(text: string) {
  return text.replace(/\/judger\/run\/[^/"]+\//g, "")
}

/**
 * 编译失败 / 运行时错误说清楚「错在第几行、为什么」—— 翻译表和题目页结果区同一份
 * （pythonError.ts / runtimeError.ts）。原来的看代码弹框压根不显示报错。
 */
const explain = computed(() => {
  const s = shown.value
  if (!s) return null
  const info = s.statisticInfo
  const err = info?.err_info ? stripJudgePath(info.err_info) : ""
  switch (s.result) {
    case SubmissionStatus.compile_error: {
      const ex = s.language === "Python" && err ? explainPythonCompileError(err) : null
      if (ex) return { line: ex.line, text: ex.message, raw: err }
      return { line: null, text: "编译没通过，看看下面的原始报错。", raw: err }
    }
    case SubmissionStatus.runtime_error: {
      const rt = info?.runtime_error
      if (rt) return { line: rt.line ?? null, text: explainRuntimeError(rt), raw: err }
      return { line: null, text: "程序运行到一半出错，停下来了。", raw: err }
    }
    case SubmissionStatus.cpu_time_limit_exceeded:
    case SubmissionStatus.real_time_limit_exceeded:
      return {
        line: null,
        text: "程序跑了太久还没结束：可能有死循环，或者在等一个没有给的输入。",
        raw: "",
      }
    case SubmissionStatus.memory_limit_exceeded:
      return { line: null, text: "程序占的内存太多了。", raw: "" }
    case SubmissionStatus.system_error:
      return { line: null, text: "判题机出错了，不是代码的问题。", raw: err }
    case SubmissionStatus.wrong_answer: {
      const check = info?.sample_check
      if (!check) return null
      const text = check.passed
        ? "题目里的例子都对，错在没公开的测试点上。"
        : `在例子 ${(check.index ?? 0) + 1} 上就错了。`
      return { line: null, text, raw: "" }
    }
    case SubmissionStatus.ast_check_failed: {
      const failedRules = (info?.ast_results ?? []).filter((rule) => !rule.passed)
      const text = failedRules.length
        ? `答案对了，但没按要求写：${failedRules.map((rule) => rule.description).join("；")}`
        : "答案对了，但没按题目要求的写法写。"
      return { line: null, text, raw: "" }
    }
    default:
      return null
  }
})

const explainTone = computed(() => {
  const r = props.row.result
  return tone(
    r === SubmissionStatus.compile_error ||
      r === SubmissionStatus.runtime_error ||
      r === SubmissionStatus.ast_check_failed
      ? "warning"
      : r === SubmissionStatus.system_error
        ? "default"
        : "error",
  )
})

const rawOpen = ref(false)
watch(
  () => props.row.id,
  () => (rawOpen.value = false),
)

const failedCaseText = computed(() => {
  const bad = cases.value
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.result !== SubmissionStatus.accepted)
  if (!bad.length) return ""
  const names = bad.map(({ index }) => index + 1).join("、")
  const kinds = new Set(bad.map(({ item }) => JUDGE_STATUS[item.result]?.name ?? ""))
  return kinds.size === 1 ? `测试点 ${names} ${[...kinds][0]}` : `测试点 ${names} 没通过`
})

function caseColor(result: number) {
  if (result === SubmissionStatus.accepted) return tone("success").solid
  if (result === SubmissionStatus.runtime_error) return tone("warning").solid
  return tone("error").solid
}

const canRejudge = computed(() => props.teacher && !props.contest)
const moreOptions = computed(() => [
  { label: "复制回到题目", key: "problem" },
  ...(shown.value?.language !== "SQL" ? [{ label: "复制到自测猫", key: "cat" }] : []),
])

function handleMore(key: string) {
  if (!shown.value) return
  if (key === "problem") copyToProblem(shown.value)
  else copyToCat(shown.value)
}

function openStandalone() {
  window.open("/submission/" + props.row.id, "_blank")
}
</script>

<template>
  <section class="pane" :class="{ narrow }">
    <div class="head">
      <div class="who">
        <!-- 点名字开个人主页（原来列表里的用户名就是这个链接） -->
        <a
          class="user-link"
          :href="`/user?name=${encodeURIComponent(row.username)}`"
          target="_blank"
        >
          <UserName :username="row.username" :muted="!!locked && locked !== 'problemset'" />
        </a>
        <button
          class="filter-pill"
          title="只看他的提交"
          aria-label="只看他的提交"
          @click="emit('filterUser', row.username)"
        >
          <Icon icon="ph:funnel-simple-bold" :width="12" />
        </button>
        <!-- 班级下拉只有网站配置里在读的班，摘掉的老班从这里筛 -->
        <button
          v-if="teacher && !contest && row.className && row.className !== className"
          class="filter-pill wide"
          :title="`只看${classLabel(row.className)}的提交`"
          :aria-label="`只看${classLabel(row.className)}的提交`"
          @click="emit('filterClass', row.className)"
        >
          {{ classLabel(row.className) }}<Icon icon="ph:funnel-simple-bold" :width="12" />
        </button>
      </div>
      <span class="dot">·</span>
      <a
        class="problem"
        href="#"
        :title="`${row.problemDisplayId} ${row.problemTitle}`"
        @click.prevent="emit('openProblem', row)"
      >
        <span class="problem-id">{{ row.problemDisplayId }}</span>
        {{ row.problemTitle }}
      </a>
      <button
        class="filter-pill"
        title="只看这道题的提交"
        aria-label="只看这道题的提交"
        @click="emit('filterProblem', row.problemDisplayId)"
      >
        <Icon icon="ph:funnel-simple-bold" :width="12" />
      </button>
      <a
        v-if="row.problemSet"
        class="problemset"
        :href="'/problemset/' + row.problemSet.id"
        target="_blank"
        :title="'从题单「' + row.problemSet.title + '」交的'"
      >
        题单 {{ row.problemSet.title }}
      </a>
      <div class="spacer"></div>
      <!-- 重判不用等代码拉下来：代码拉不下来的那条，恰恰可能要重判 -->
      <n-button v-if="canRejudge" size="small" @click="emit('rejudge', row.id)">
        <template #icon><Icon icon="ph:arrow-clockwise" /></template>
        重新判题
      </n-button>
      <template v-if="shown">
        <template v-if="teacher">
          <n-button
            size="small"
            quaternary
            title="新页面打开（有测试点明细）"
            aria-label="新页面打开"
            @click="openStandalone"
          >
            <template #icon><Icon icon="ph:arrow-square-out" /></template>
          </n-button>
          <n-dropdown :options="moreOptions" trigger="click" @select="handleMore">
            <n-button size="small" quaternary aria-label="更多" title="复制回到题目、复制到自测猫">
              <template #icon><Icon icon="ph:dots-three-bold" /></template>
            </n-button>
          </n-dropdown>
        </template>
        <template v-else>
          <n-button size="small" type="primary" @click="copyToProblem(shown)">
            <template #icon><Icon icon="ph:arrow-u-up-left" /></template>
            复制回到题目
          </n-button>
          <n-button v-if="shown.language !== 'SQL'" size="small" @click="copyToCat(shown)">
            复制到自测猫
          </n-button>
          <n-button
            size="small"
            quaternary
            title="新页面打开"
            aria-label="新页面打开"
            @click="openStandalone"
          >
            <template #icon><Icon icon="ph:arrow-square-out" /></template>
          </n-button>
        </template>
      </template>
    </div>

    <div class="meta">
      <StatusPill :result="row.result" />
      <span v-if="teacher && cases.length" class="cases">
        <span
          v-for="(item, index) in cases"
          :key="index"
          class="case"
          :style="{ background: caseColor(item.result), color: isDark ? '#18181c' : '#ffffff' }"
          :title="`测试点 ${index + 1}：${JUDGE_STATUS[item.result]?.name ?? ''}`"
        >
          {{ index + 1 }}
        </span>
        <span v-if="failedCaseText" class="muted">{{ failedCaseText }}</span>
      </span>
      <span
        v-else-if="row.caseSummary && row.caseSummary.passed < row.caseSummary.total"
        class="partial"
        :style="{ color: tone('error').color }"
      >
        通过 {{ row.caseSummary.passed }}/{{ row.caseSummary.total }} 个测试点
      </span>
      <span>{{ LANGUAGE_SHOW_VALUE[row.language] }}</span>
      <span>{{ submissionTimeText(row.createTime, true) }}</span>
      <template v-if="row.statisticInfo?.time_cost !== undefined">
        <span>耗时 {{ submissionTimeFormat(row.statisticInfo.time_cost) }}</span>
        <span>内存 {{ submissionMemoryFormat(row.statisticInfo.memory_cost) }}</span>
      </template>
    </div>

    <!-- 看不到代码的三种情况 -->
    <div v-if="locked" class="locked">
      <Icon icon="ph:lock-simple" :width="30" class="lock-icon" />
      <template v-if="locked === 'others'">
        <span class="locked-title">别人的代码看不到</span>
        <span class="muted">自己动手做出来，才是自己的。</span>
        <n-button type="primary" @click="emit('openProblem', row)">
          去做 {{ row.problemDisplayId }} {{ row.problemTitle }}
        </n-button>
      </template>
      <template v-else-if="locked === 'problemset'">
        <span class="locked-title">这道题在你加入的题单里</span>
        <span class="muted">加入题单之前交的代码先藏起来，在题单里做完这道题就能看到。</span>
      </template>
      <template v-else>
        <span class="locked-title">登录之后才能看自己的代码</span>
        <span class="muted">谁交了什么题、对没对，不登录也能看。</span>
      </template>
    </div>

    <template v-else>
      <div
        v-if="explain"
        class="explain"
        :style="{ background: explainTone.background, borderColor: explainTone.background }"
      >
        <div class="explain-line">
          <b :style="{ color: explainTone.color }">
            <template v-if="explain.line">第 {{ explain.line }} 行：</template>{{ explain.text }}
          </b>
          <div class="spacer"></div>
          <a v-if="explain.raw" href="#" class="raw-toggle" @click.prevent="rawOpen = !rawOpen">
            原始报错
            <Icon :icon="rawOpen ? 'ph:caret-up-bold' : 'ph:caret-down-bold'" :width="11" />
          </a>
        </div>
        <pre v-if="rawOpen && explain.raw" class="raw">{{ explain.raw }}</pre>
      </div>
      <CodeView
        v-if="shown"
        :code="shown.code"
        :language="LANGUAGE_FORMAT_VALUE[shown.language]"
        :mark-line="explain?.line ?? null"
      />
      <div v-else class="placeholder">
        <n-spin v-if="loading" size="small" />
        <span v-else-if="failed" class="muted">
          代码没拉下来，
          <a href="#" @click.prevent="load">再试一次</a>
        </span>
      </div>
    </template>

    <div v-if="!narrow" class="foot">
      <span class="keys"><kbd>↑</kbd><kbd>↓</kbd></span>
      <span>
        {{
          teacher
            ? "换上一条 / 下一条，到本页头尾自动翻页"
            : "换上一条 / 下一条（只在能看代码的提交之间走）"
        }}
      </span>
      <div class="spacer"></div>
      <span v-if="position">本页第 {{ position.index }} / {{ position.count }} 条</span>
    </div>
  </section>
</template>

<style scoped>
.pane {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 14px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: v-bind("theme.bodyColor");
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  font-size: 15px;
  min-width: 0;
}

/* 顶上固定一行：按方向键翻条时这一行高度不能变，不然下面的代码区跟着上下跳。
   名字和按钮不缩，题目名太长时省略（全名在 title 里） */
.head .who {
  flex-shrink: 0;
}

.head .problem {
  flex: 0 1 auto;
}

.narrow {
  padding: 12px 14px;
}

.narrow .head {
  flex-wrap: wrap;
  row-gap: 8px;
}

.narrow .head .spacer {
  flex-basis: 100%;
}

.user-link {
  display: flex;
  min-width: 0;
  text-decoration: none;
}

.user-link:hover :deep(.name) {
  color: v-bind("theme.primaryColor");
}

.who {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dot {
  color: v-bind("theme.textColor3");
}

.problem {
  color: v-bind("theme.textColor1");
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.problem:hover {
  color: v-bind("theme.primaryColor");
}

.problem-id {
  color: v-bind("theme.textColor3");
}

.problemset {
  flex: none;
  height: 20px;
  padding: 0 7px;
  border-radius: 10px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: v-bind("tone('info').color");
  background: v-bind("tone('info').background");
}

/* 只留漏斗图标（右栏六百来宽，带字的话名字、题目和按钮排不进一行），字在 title 里 */
.filter-pill {
  flex: none;
  width: 24px;
  height: 22px;
  padding: 0;
  justify-content: center;
  border: 1px solid v-bind("tone('success').background");
  border-radius: 11px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: v-bind("tone('success').color");
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
}

.filter-pill.wide {
  width: auto;
  padding: 0 8px;
  white-space: nowrap;
}

.filter-pill:hover {
  background: v-bind("tone('success').background");
}

.spacer {
  flex: 1 1 0;
}

.meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
  flex-wrap: wrap;
  row-gap: 6px;
}

.cases {
  display: inline-flex;
  align-items: center;
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

.cases .muted {
  margin-left: 4px;
}

.partial {
  font-weight: 600;
}

.muted {
  color: v-bind("theme.textColor3");
}

.explain {
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.explain-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  line-height: 1.6;
}

.raw-toggle {
  flex: none;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: v-bind("theme.textColor3");
  text-decoration: none;
}

.raw {
  margin: 0;
  max-height: 140px;
  overflow: auto;
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.locked,
.placeholder {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 16px;
  border-radius: 6px;
}

.locked {
  border: 1px dashed v-bind("theme.borderColor");
  background: v-bind("theme.cardColor");
}

.lock-icon {
  color: v-bind("theme.textColor3");
  opacity: 0.7;
}

.locked-title {
  font-size: 16px;
  font-weight: 600;
}

.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.keys {
  display: inline-flex;
  gap: 3px;
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
</style>
