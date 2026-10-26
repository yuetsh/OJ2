<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import { getFlowchartSubmission } from 'oj/api'
import { useMermaid } from 'shared/composables/useMermaid'
import { sortFlowchartCriteria } from 'utils/constants'
import type { FlowchartSubmission, FlowchartSubmissionListItem } from 'utils/types'
import { FlowchartSubmissionStatus } from 'utils/types'
import { useTone } from 'shared/composables/tone'
import { submissionTimeText } from '../utils'
import FlowchartState from './FlowchartState.vue'
import UserName from 'shared/components/UserName.vue'
import FlowchartNote from 'shared/components/FlowchartNote.vue'
import { caseReport, flowchartVerdict } from 'utils/flowchart'

/**
 * 流程图模式的右栏：左边画出来的图，右边四项评分和建议。原来要点编号再开一个
 * 1000px 宽的弹框（FlowchartScoreDetail），翻全班的图时一样是「开 → 关 → 开」。
 */
const props = defineProps<{
  row: FlowchartSubmissionListItem
  teacher: boolean
  position: { index: number; count: number } | null
  /** 手机上的整屏详情：头部折行、图和评分上下排、不提方向键 */
  narrow?: boolean
}>()

const emit = defineEmits<{
  filterUser: [username: string]
  filterProblem: [displayId: string]
  openProblem: [row: FlowchartSubmissionListItem]
  retry: [id: string]
}>()

const theme = useThemeVars()
const tone = useTone()
const { renderError, renderFlowchart } = useMermaid()

const detail = ref<FlowchartSubmission | null>(null)
const loading = ref(false)
const failed = ref(false)
const cache = new Map<string, FlowchartSubmission>()

const graph = useTemplateRef<HTMLElement>('graph')
const bigGraph = useTemplateRef<HTMLElement>('bigGraph')
const bigOpen = ref(false)

const evaluating = computed(() => props.row.status === FlowchartSubmissionStatus.PENDING || props.row.status === FlowchartSubmissionStatus.PROCESSING)

/**
 * 按 id 缓存，重新评分一开始（状态回到排队 / 评分中）就把这一条扔掉。原来按「id + 状态」
 * 缓存，评完 → 排队 → 评分中 → 评完 转一圈回来正好命中重评之前的旧评语
 */
let loadSeq = 0

async function load() {
  const row = props.row
  const seq = ++loadSeq
  failed.value = false
  bigOpen.value = false
  if (evaluating.value) cache.delete(row.id)
  if (!row.showLink) {
    detail.value = null
    return
  }
  let res = cache.get(row.id)
  if (!res || res.status !== row.status) {
    loading.value = true
    try {
      res = await getFlowchartSubmission(row.id)
      if (seq !== loadSeq) return
      if (!evaluating.value && res.status === props.row.status) cache.set(row.id, res)
    } catch {
      if (seq !== loadSeq) return
      failed.value = true
      // 别让上一条的图留在那儿，旁边却写着「没拉下来」
      detail.value = null
      if (graph.value) graph.value.innerHTML = ''
      return
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }
  if (seq !== loadSeq) return
  detail.value = res
  await nextTick()
  await renderFlowchart(graph.value, res.mermaidCode)
  fitGraph(graph.value)
  markFocus(graph.value)
}

/**
 * 图填满图框：大图照旧缩小，小图也放大，但最多到原尺寸的 1.5 倍（再大字就粗笨了）。
 * 原来只缩不放，比大小这种五六个框的图在一大块空白中间只占一小团
 */
function fitGraph(el: HTMLElement | null) {
  const svg = el?.querySelector('svg')
  const w = Number.parseFloat(svg?.getAttribute('width') ?? '')
  const h = Number.parseFloat(svg?.getAttribute('height') ?? '')
  if (!svg || !w || !h) return
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.style.width = '100%'
  svg.style.height = '100%'
  svg.style.maxWidth = `${w * 1.5}px`
  svg.style.maxHeight = `${h * 1.5}px`
}

/**
 * 要改的那个框标红：AI 对着答案指出的，没有就退回程序找到的第一处出错的框。
 * pele 把 Mermaid 的框号放在节点 <g> 的 data-id 上
 */
function markFocus(el: HTMLElement | null) {
  const focus = report.value?.focus ?? report.value?.cases.find((row) => !row.ok)?.wrongAt
  if (!el || !focus) return
  el.querySelector(`.pele-node[data-id="${focus}"]`)?.classList.add('oj-focus')
}

// 分开写三个来源：列表每次轮询都换一批新的行对象，一个 getter 返回数组的话回调次次都跑
watch([() => props.row.id, () => props.row.status, () => props.row.showLink], load, {
  immediate: true,
})

watch(bigOpen, async (open) => {
  if (!open || !detail.value) return
  await nextTick()
  await renderFlowchart(bigGraph.value, detail.value.mermaidCode)
  markFocus(bigGraph.value)
})

const shown = computed(() => (detail.value?.id === props.row.id ? detail.value : null))

/**
 * 评分项明细。内容是 AI 模型原样吐出的 JSON，后端不校验形状，只能按约定断言，
 * 字段缺失时用 0 / 空串兜底。jsonb 不保留键序，按固定顺序排（逻辑正确性在最前）
 */
const criteria = computed(() => {
  const raw = shown.value?.aiCriteriaDetails ?? {}
  const parsed = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      const item = (value ?? {}) as Partial<{ score: number; max: number; comment: string }>
      return [key, { score: item.score ?? 0, max: item.max ?? 0, comment: item.comment ?? '' }]
    }),
  )
  return sortFlowchartCriteria(parsed)
})

function barColor(score: number, max: number) {
  const pct = max ? score / max : 0
  if (pct >= 0.8) return tone('success').solid
  if (pct >= 0.6) return tone('info').solid
  if (pct >= 0.4) return tone('warning').solid
  return tone('error').solid
}

/** 2026-10 起的「走例子」报告；老提交是 null，照旧显示四项分 */
const report = computed(() => caseReport(shown.value?.aiCriteriaDetails))
const openCase = ref<number | null>(null)
/** 逐组数据默认收着，老师和学生一样（设计稿 FlowNotePane）；翻到下一张收回去 */
const casesOpen = ref(false)
watch(
  () => shown.value?.id,
  () => {
    openCase.value = null
    casesOpen.value = false
  },
)

const suggestions = computed(() =>
  (shown.value?.aiSuggestions ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
)

const canRetry = computed(
  () => props.teacher && (props.row.status === FlowchartSubmissionStatus.COMPLETED || props.row.status === FlowchartSubmissionStatus.FAILED),
)
</script>

<template>
  <section class="pane" :class="{ narrow }">
    <div class="head">
      <div class="who">
        <a class="user-link" :href="`/user?name=${encodeURIComponent(row.username)}`" target="_blank">
          <UserName :username="row.username" />
        </a>
        <button class="filter-pill" title="只看这个人的提交" aria-label="只看这个人的提交" @click="emit('filterUser', row.username)">
          <Icon icon="ph:funnel-simple-bold" :width="12" />
        </button>
      </div>
      <span v-if="!narrow" class="dot">·</span>
      <!-- display: contents 的壳：桌面上照旧一行，手机上题目整行另起 -->
      <span class="problem-group">
        <a class="problem" href="#" :title="`${row.problemDisplayId} ${row.problemTitle}`" @click.prevent="emit('openProblem', row)">
          <span class="problem-id">{{ row.problemDisplayId }}</span>
          {{ row.problemTitle }}
        </a>
        <button class="filter-pill" title="只看这道题的提交" aria-label="只看这道题的提交" @click="emit('filterProblem', row.problemDisplayId)">
          <Icon icon="ph:funnel-simple-bold" :width="12" />
        </button>
      </span>
      <div class="spacer"></div>
      <!-- 右栏窄时这两个只剩图标（字在 title 里），把宽度让给题目名 -->
      <n-button v-if="shown && !renderError && shown.mermaidCode" class="head-btn" size="small" title="查看大图" @click="bigOpen = true">
        <template #icon><Icon icon="ph:corners-out" /></template>
        查看大图
      </n-button>
      <n-button v-if="teacher" class="head-btn" size="small" title="重新评分" :disabled="!canRetry" @click="emit('retry', row.id)">
        <template #icon><Icon icon="ph:arrow-clockwise" /></template>
        重新评分
      </n-button>
    </div>

    <div class="meta">
      <FlowchartState :status="row.status" :grade="row.aiGrade" />
      <span>{{ submissionTimeText(row.createTime, true) }}</span>
      <span v-if="row.processingTime">评分用时 {{ row.processingTime.toFixed(1) }} 秒</span>
    </div>

    <div v-if="!row.showLink" class="locked">
      <Icon icon="ph:lock-simple" :width="30" class="lock-icon" />
      <!-- 列表项里没有 userId，分不出是别人的还是自己被题单挡住的，文案两种都说得通 -->
      <span class="locked-title">这张流程图看不到</span>
      <span class="muted">别人画的看不到；自己以前画的在题单布置期内先藏着，在题单里做对或者布置期结束就能看到。</span>
    </div>
    <div v-else class="body">
      <div class="graph-box">
        <!-- mermaid 的报错是英文，学生看自己的图也会碰到：先说中文，原文折起来 -->
        <div v-if="renderError" class="render-error">
          <b>这张流程图画不出来</b>
          <span class="muted">可能是画的时候有框没连上，或者文字里有特殊符号。</span>
          <n-collapse>
            <n-collapse-item title="原始报错" name="raw">
              <pre class="raw">{{ renderError }}</pre>
            </n-collapse-item>
          </n-collapse>
        </div>
        <div v-show="!renderError" ref="graph" class="graph"></div>
        <n-spin v-if="loading && !shown" size="small" />
        <span v-if="failed" class="muted">没拉下来，<a href="#" @click.prevent="load">再试一次</a></span>
      </div>
      <div class="score-box">
        <template v-if="evaluating">
          <n-spin size="small" />
          <span class="muted">AI 正在评分，一般几秒钟</span>
        </template>
        <template v-else-if="row.status === FlowchartSubmissionStatus.FAILED">
          <span class="muted">这次评分失败了{{ teacher ? '，可以点「重新评分」' : '' }}</span>
        </template>
        <template v-else-if="shown && report">
          <b class="headline">{{ flowchartVerdict(report, shown.aiGrade) }}</b>
          <FlowchartNote
            v-model:selected="openCase"
            v-model:open="casesOpen"
            :report="report"
            :feedback="shown.aiFeedback"
            :suggestions="shown.aiSuggestions"
            :previous="shown.previousCases"
            compact
          />
        </template>
        <template v-else-if="shown">
          <div v-for="[name, item] in criteria" :key="name" class="crit">
            <div class="crit-head">
              <b>{{ name }}</b>
              <div class="spacer"></div>
              <span class="num">{{ item.score }} / {{ item.max }}</span>
            </div>
            <div class="bar">
              <div
                class="bar-fill"
                :style="{
                  width: `${item.max ? Math.min(100, (item.score / item.max) * 100) : 0}%`,
                  background: barColor(item.score, item.max),
                }"
              ></div>
            </div>
            <div v-if="item.comment" class="muted small">{{ item.comment }}</div>
          </div>
          <div v-if="shown.aiFeedback" class="note">{{ shown.aiFeedback }}</div>
          <div v-if="suggestions.length" class="note">
            <b>改进建议：</b>
            <div v-for="(line, i) in suggestions" :key="i">{{ line }}</div>
          </div>
        </template>
      </div>
    </div>

    <div v-if="!narrow" class="foot">
      <span class="keys"><kbd>↑</kbd><kbd>↓</kbd></span>
      <span class="hint">换上一张 / 下一张</span>
      <div class="spacer"></div>
      <span v-if="position">本页第 {{ position.index }} / {{ position.count }} 条</span>
    </div>

    <n-modal v-model:show="bigOpen" preset="card" title="流程图" style="width: 90vw">
      <div ref="bigGraph" class="big-graph"></div>
    </n-modal>
  </section>
</template>

<style scoped>
.pane {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 18px var(--oj-pad-x) 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: v-bind('theme.bodyColor');
  container: pane / inline-size;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  font-size: 16px;
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
  overflow-y: auto;
}

.narrow .head {
  flex-wrap: wrap;
  row-gap: 8px;
}

.problem-group {
  display: contents;
}

/* 手机：第一行名字，第二行题目，第三行「查看大图」「重新评分」 */
.narrow .head .spacer {
  display: none;
}

.narrow .problem-group {
  flex-basis: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.narrow .problem {
  white-space: normal;
}

.narrow .filter-pill {
  width: 32px;
  height: 28px;
  border-radius: 14px;
}

.narrow .meta {
  flex-wrap: wrap;
  row-gap: 6px;
}

.narrow .body {
  flex-direction: column;
  flex: none;
}

.narrow .graph-box {
  flex: none;
  height: 320px;
}

/* 原来还是 flex: 1 1 0 + overflow: auto：外层不定高，评分那一栏被压成一条缝，只露出半行字 */
.narrow .score-box {
  flex: none;
  overflow: visible;
}

.narrow .locked {
  flex: 1 0 auto;
  min-height: 280px;
  padding: 16px;
  text-align: center;
}

.user-link {
  display: flex;
  min-width: 0;
  text-decoration: none;
}

.user-link :deep(.name) {
  color: v-bind('theme.primaryColor');
}

.user-link:hover :deep(.name) {
  text-decoration: underline;
}

.render-error {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  align-self: stretch;
}

.raw {
  margin: 0;
  max-height: 140px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.who {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dot,
.problem-id,
.muted {
  color: v-bind('theme.textColor3');
}

.problem {
  color: v-bind('theme.primaryColor');
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
}

.problem:hover {
  text-decoration: underline;
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

.spacer {
  flex: 1 1 0;
}

.meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--oj-fs-sec);
  color: v-bind('theme.textColor3');
}

.body {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  gap: 12px;
}

.graph-box,
.score-box,
.locked {
  border: 1px solid v-bind('theme.dividerColor');
  border-radius: 6px;
  background: v-bind('theme.cardColor');
}

/* 图占大头（设计稿 FlowNotePane）：42% 时蜜橘分拣这种宽图只剩三成大，框里的字看不清 */
.graph-box {
  flex: 0 0 62%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 8px;
  box-sizing: border-box;
}

.graph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.graph :deep(svg) {
  max-width: 100%;
  max-height: 100%;
}

.headline {
  font-size: 17px;
}

/* 要改的框：压过 useMermaid 里按框类型上的色（那边也是 !important） */
.graph :deep(.pele-node.oj-focus > :not(text)),
.big-graph :deep(.pele-node.oj-focus > :not(text)) {
  fill: v-bind("tone('error').background") !important;
  stroke: v-bind("tone('error').solid") !important;
  stroke-width: 3px !important;
}

.score-box {
  flex: 1 1 0;
  min-width: 0;
  overflow: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.crit {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.crit-head {
  display: flex;
  align-items: center;
}

.num {
  font-variant-numeric: tabular-nums;
}

.bar {
  height: 6px;
  border-radius: 3px;
  background: v-bind('theme.dividerColor');
}

.bar-fill {
  height: 6px;
  border-radius: 3px;
}

.small {
  font-size: 12px;
}

.note {
  font-size: 13px;
  line-height: 1.6;
  border-top: 1px solid v-bind('theme.dividerColor');
  padding-top: 10px;
}

.locked {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-style: dashed;
}

.lock-icon {
  color: v-bind('theme.textColor3');
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
  color: v-bind('theme.textColor3');
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
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 3px;
  background: v-bind('theme.cardColor');
  font: inherit;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.big-graph {
  display: flex;
  justify-content: center;
  overflow: auto;
  max-height: 80vh;
}

/* 桌面右栏窄了（屏窄、浏览器放大、列表没收窄）：顶行一行排不下就固定拆成两行 ——
   名字和按钮一行、题目一行。按宽度定、不按内容定，翻条时高度照样不变 */
@container pane (max-width: 760px) {
  .pane:not(.narrow) .head-btn {
    padding: 0 7px;
  }

  .pane:not(.narrow) .head-btn :deep(.n-button__content) {
    display: none;
  }

  .pane:not(.narrow) .head-btn :deep(.n-button__icon) {
    margin: 0;
  }
}

@container pane (max-width: 600px) {
  .pane:not(.narrow) .head {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  .pane:not(.narrow) .dot {
    display: none;
  }

  /* 名字这块占掉按钮左边的全部宽度、从 0 起算：再窄也只是名字被截，按钮不会掉到下一行 */
  .pane:not(.narrow) .head .who {
    flex: 1 1 0;
    overflow: hidden;
  }

  .pane:not(.narrow) .head .spacer {
    display: none;
  }

  .pane:not(.narrow) .user-link {
    flex-shrink: 0;
  }

  .pane:not(.narrow) .problem-group {
    order: 3;
    flex-basis: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pane:not(.narrow) .keys,
  .pane:not(.narrow) .hint {
    display: none;
  }
}
</style>
