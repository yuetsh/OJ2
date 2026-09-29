<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { getFlowchartSubmission } from "oj/api"
import { useMermaid } from "shared/composables/useMermaid"
import { sortFlowchartCriteria } from "utils/constants"
import type { FlowchartSubmission, FlowchartSubmissionListItem } from "utils/types"
import { FlowchartSubmissionStatus } from "utils/types"
import { useTone } from "../composables/tone"
import { submissionTimeText } from "../utils"
import FlowchartState from "./FlowchartState.vue"
import UserName from "./UserName.vue"

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

const graph = useTemplateRef<HTMLElement>("graph")
const bigGraph = useTemplateRef<HTMLElement>("bigGraph")
const bigOpen = ref(false)

const evaluating = computed(
  () =>
    props.row.status === FlowchartSubmissionStatus.PENDING ||
    props.row.status === FlowchartSubmissionStatus.PROCESSING,
)

async function load() {
  const row = props.row
  failed.value = false
  bigOpen.value = false
  if (!row.showLink) {
    detail.value = null
    return
  }
  const key = `${row.id}:${row.status}`
  let res = cache.get(key)
  if (!res) {
    loading.value = true
    try {
      res = await getFlowchartSubmission(row.id)
      if (!evaluating.value) cache.set(key, res)
    } catch {
      if (props.row.id === row.id) failed.value = true
      return
    } finally {
      if (props.row.id === row.id) loading.value = false
    }
  }
  if (props.row.id !== row.id) return
  detail.value = res
  await nextTick()
  await renderFlowchart(graph.value, res.mermaidCode)
}

watch(() => [props.row.id, props.row.status, props.row.showLink] as const, load, {
  immediate: true,
})

watch(bigOpen, async (open) => {
  if (!open || !detail.value) return
  await nextTick()
  await renderFlowchart(bigGraph.value, detail.value.mermaidCode)
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
      return [key, { score: item.score ?? 0, max: item.max ?? 0, comment: item.comment ?? "" }]
    }),
  )
  return sortFlowchartCriteria(parsed)
})

function barColor(score: number, max: number) {
  const pct = max ? score / max : 0
  if (pct >= 0.8) return tone("success").solid
  if (pct >= 0.6) return tone("info").solid
  if (pct >= 0.4) return tone("warning").solid
  return tone("error").solid
}

const suggestions = computed(() =>
  (shown.value?.aiSuggestions ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
)

const canRetry = computed(
  () =>
    props.teacher &&
    (props.row.status === FlowchartSubmissionStatus.COMPLETED ||
      props.row.status === FlowchartSubmissionStatus.FAILED),
)
</script>

<template>
  <section class="pane" :class="{ narrow }">
    <div class="head">
      <div class="who">
        <UserName :username="row.username" />
        <button v-if="teacher" class="filter-pill" @click="emit('filterUser', row.username)">
          <Icon icon="ph:funnel-simple-bold" :width="11" />只看他
        </button>
      </div>
      <span class="dot">·</span>
      <a class="problem" href="#" @click.prevent="emit('openProblem', row)">
        <span class="problem-id">{{ row.problemDisplayId }}</span>
        {{ row.problemTitle }}
      </a>
      <button
        v-if="teacher"
        class="filter-pill"
        @click="emit('filterProblem', row.problemDisplayId)"
      >
        <Icon icon="ph:funnel-simple-bold" :width="11" />只看这题
      </button>
      <div class="spacer"></div>
      <n-button
        v-if="shown && !renderError && shown.mermaidCode"
        size="small"
        @click="bigOpen = true"
      >
        <template #icon><Icon icon="ph:corners-out" /></template>
        查看大图
      </n-button>
      <n-button v-if="teacher" size="small" :disabled="!canRetry" @click="emit('retry', row.id)">
        <template #icon><Icon icon="ph:arrow-clockwise" /></template>
        重新评分
      </n-button>
    </div>

    <div class="meta">
      <FlowchartState :status="row.status" :grade="row.aiGrade" :score="row.aiScore" />
      <span>{{ submissionTimeText(row.createTime, true) }}</span>
      <span v-if="row.processingTime">评分用时 {{ row.processingTime.toFixed(1) }} 秒</span>
    </div>

    <div v-if="!row.showLink" class="locked">
      <Icon icon="ph:lock-simple" :width="30" class="lock-icon" />
      <span class="locked-title">别人画的流程图看不到</span>
    </div>
    <div v-else class="body">
      <div class="graph-box">
        <n-alert v-if="renderError" type="error" title="流程图画不出来">
          {{ renderError }}
        </n-alert>
        <div v-show="!renderError" ref="graph" class="graph"></div>
        <n-spin v-if="loading && !shown" size="small" />
        <span v-if="failed" class="muted"
          >没拉下来，<a href="#" @click.prevent="load">再试一次</a></span
        >
      </div>
      <div class="score-box">
        <template v-if="evaluating">
          <n-spin size="small" />
          <span class="muted">AI 正在评分，一般几秒钟</span>
        </template>
        <template v-else-if="row.status === FlowchartSubmissionStatus.FAILED">
          <span class="muted">这次评分失败了{{ teacher ? "，可以点「重新评分」" : "" }}</span>
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
      <span>换上一张 / 下一张</span>
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
}

.narrow {
  padding: 12px 14px;
  overflow-y: auto;
}

.narrow .head {
  flex-wrap: wrap;
  row-gap: 8px;
}

.narrow .head .spacer {
  flex-basis: 100%;
}

.narrow .body {
  flex-direction: column;
  flex: none;
}

.narrow .graph-box {
  flex: none;
  height: 320px;
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
  color: v-bind("theme.textColor3");
}

.problem {
  color: v-bind("theme.textColor1");
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
}

.filter-pill {
  flex: none;
  height: 22px;
  padding: 0 7px;
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
  font-size: 13px;
  color: v-bind("theme.textColor3");
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
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
}

.graph-box {
  flex: 0 0 42%;
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
  background: v-bind("theme.dividerColor");
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
  border-top: 1px solid v-bind("theme.dividerColor");
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

.big-graph {
  display: flex;
  justify-content: center;
  overflow: auto;
  max-height: 80vh;
}
</style>
