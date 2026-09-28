<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useCodeStore } from "oj/store/code"
import { isFlowchartPass, useFlowchartStore } from "oj/store/flowchart"
import { useProblemStore } from "oj/store/problem"
import { sortFlowchartCriteria } from "utils/constants"
import { decompressFromBase64, parseTime } from "utils/functions"

/**
 * 「结果」页签里流程图作业的那一块：AI 在评 / 评完了几分 / 历次分数 / 评语和改进建议。
 *
 * 原来评分详情是提交按钮旁一个 1000px 的弹框：盖住画布，学生没法一边看改进建议一边改图；
 * 翻历次评分要一页一页点分页器。现在摆在左栏，画布整列都在右边（设计文档第 6 节）。
 */

const flowchartStore = useFlowchartStore()
const { phase, scores, hiddenCount, selectedId, details, detailLoading, editor } =
  storeToRefs(flowchartStore)
const problemStore = useProblemStore()
const codeStore = useCodeStore()
const message = useMessage()

/** 正在看的那一次：点过哪次就是哪次，否则是最新的 */
const current = computed(() => {
  const id = selectedId.value ?? scores.value.at(-1)?.id
  return id ? (scores.value.find((row) => row.id === id) ?? null) : null
})
const currentIndex = computed(() =>
  current.value ? scores.value.findIndex((row) => row.id === current.value!.id) : -1,
)
const detail = computed(() => (current.value ? details.value[current.value.id] : undefined))
const viewingLatest = computed(() => selectedId.value === null)

// 评完的那次、点到的那次，评语都要现拉（历次分数里只有分数）
watch(
  () => current.value?.id,
  (id) => {
    if (id && !details.value[id]) flowchartStore.select(selectedId.value)
  },
  { immediate: true },
)

const criteria = computed(() =>
  sortFlowchartCriteria(
    (detail.value?.aiCriteriaDetails ?? {}) as Record<
      string,
      { score: number; max: number; comment?: string }
    >,
  ),
)
const suggestions = computed(() =>
  (detail.value?.aiSuggestions ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
)

function gradeType(grade: string) {
  if (isFlowchartPass(grade)) return "success"
  if (grade === "B") return "warning"
  return "error"
}

function percentType(ratio: number) {
  if (ratio >= 0.8) return "success"
  if (ratio >= 0.6) return "info"
  if (ratio >= 0.4) return "warning"
  return "error"
}

// ==================== 载回画布 ====================
/** 这一版的画布数据（压缩前的 JSON 字符串）；老提交的压缩数据可能是坏的 */
const versionJson = computed(() => {
  const data = detail.value?.flowchartData?.data
  if (typeof data !== "string" || !data) return null
  try {
    return decompressFromBase64(data)
  } catch {
    return null
  }
})

/**
 * 一张图「长什么样」：节点的 id / 类型 / data（字写在里面）/ 位置，连线的两端和标签。不直接比 JSON 字符串 ——
 * 载回画布时编辑器会补上默认字段（sourceHandle: null 之类），老提交还带着 vue-flow 的运行时
 * 字段，字符串永远对不上，按钮就一直在。
 */
type Shape = { nodes?: unknown[]; edges?: unknown[] }
function signature(data: Shape) {
  const nodes = (data.nodes ?? []).map((raw) => {
    const node = raw as {
      id?: string
      type?: string
      data?: unknown
      position?: { x?: number; y?: number }
    }
    return [
      node.id,
      node.type,
      // 节点上的字（customLabel）和原始类型都在 data 里，整个带上
      JSON.stringify(node.data ?? {}),
      Math.round(node.position?.x ?? 0),
      Math.round(node.position?.y ?? 0),
    ].join("|")
  })
  const edges = (data.edges ?? []).map((raw) => {
    const edge = raw as {
      source?: string
      target?: string
      sourceHandle?: string | null
      targetHandle?: string | null
      label?: unknown
    }
    return [
      edge.source,
      edge.target,
      edge.sourceHandle ?? "",
      edge.targetHandle ?? "",
      edge.label ?? "",
    ].join("|")
  })
  return JSON.stringify([nodes.sort(), edges.sort()])
}

const versionSignature = computed(() => {
  if (!versionJson.value) return null
  try {
    return signature(JSON.parse(versionJson.value) as Shape)
  } catch {
    return null
  }
})

/**
 * 只有画布和这一版不一样时才给「载回画布」：刚交完、还没动过的时候，这个按钮点了什么
 * 都不会变，只会让人以为它坏了。读 getFlowchartData() 会顺带跟踪画布的节点和边。
 */
const canvasDiffers = computed(() => {
  if (!editor.value || !versionSignature.value) return false
  return signature(editor.value.getFlowchartData()) !== versionSignature.value
})

function loadToCanvas() {
  if (!editor.value || !versionJson.value) return
  try {
    const json = JSON.parse(versionJson.value)
    editor.value.setFlowchartData({ nodes: json.nodes || [], edges: json.edges || [] })
    message.success("已载回画布，按 Ctrl+Z 可以撤回")
  } catch {
    message.error("这一版的图数据坏了，载不回画布")
  }
}

/** A / S 之后：照着图写代码。切回学生习惯的那门语言 */
const canCode = computed(() => problemStore.codeLanguages.length > 0)
function goCode() {
  problemStore.switchLanguage(problemStore.supportedLanguage(codeStore.preferredLanguage()))
}
</script>

<template>
  <div class="flowchart-result">
    <!-- 正在评：评的是最新这一次，所以只在看最新时显示 -->
    <n-alert
      v-if="phase === 'evaluating' && viewingLatest"
      type="info"
      :show-icon="false"
      class="block"
    >
      <n-flex align="center" :size="10" :wrap="false">
        <n-spin :size="18" />
        <div>
          <b>AI 正在看你的图</b>（一般 5 秒左右）
          <div class="note">评的时候画布还能改，改了不影响这一次</div>
        </div>
      </n-flex>
    </n-alert>

    <n-alert
      v-else-if="phase === 'failed' && viewingLatest"
      type="warning"
      :show-icon="false"
      class="block"
    >
      AI 这次没评出来，再点一次「交给 AI 点评」试试
    </n-alert>

    <n-empty
      v-if="!scores.length && phase !== 'evaluating'"
      class="empty"
      description="还没交过流程图。画好之后点「交给 AI 点评」，评分和建议会出现在这里"
    />

    <template v-if="scores.length">
      <!-- 历次分数：一眼看出是不是越改越好 -->
      <div class="history" role="list" aria-label="历次分数">
        <button
          v-for="(row, index) in scores"
          :key="row.id"
          type="button"
          role="listitem"
          class="attempt"
          :class="[gradeType(row.grade), { active: current?.id === row.id }]"
          :title="parseTime(row.createTime, 'MM-DD HH:mm')"
          @click="flowchartStore.select(index === scores.length - 1 ? null : row.id)"
        >
          <span class="attempt-no">第 {{ index + 1 }} 次</span>
          <b>{{ row.score }}</b>
          <span>{{ row.grade }}</span>
        </button>
      </div>
      <p v-if="hiddenCount" class="note">
        另外 {{ hiddenCount }} 次是加入题单之前画的，先藏起来了：在题单里画到 A 或 S 就解锁
      </p>

      <section v-if="current" class="block">
        <n-flex align="baseline" :size="10">
          <n-text :type="gradeType(current.grade)" class="score">
            {{ current.score }} 分 · {{ current.grade }} 级
          </n-text>
          <n-text depth="3" class="note">
            第 {{ currentIndex + 1 }} 次 · {{ parseTime(current.createTime, "MM-DD HH:mm") }}
          </n-text>
        </n-flex>

        <n-flex v-if="isFlowchartPass(current.grade)" align="center" class="pass" :size="12">
          <span>画到 {{ current.grade }} 级了，这道题的流程图算做完 ✓</span>
          <n-button v-if="canCode" size="small" type="primary" @click="goCode">
            照着它写代码 →
          </n-button>
        </n-flex>

        <n-flex v-if="detailLoading && !detail" justify="center" class="pad">
          <n-spin size="small" />
        </n-flex>

        <template v-if="detail">
          <p v-if="detail.aiFeedback" class="feedback">{{ detail.aiFeedback }}</p>

          <div v-if="suggestions.length" class="suggestions">
            <h4>可以这样改</h4>
            <ol>
              <li v-for="(line, index) in suggestions" :key="index">{{ line }}</li>
            </ol>
          </div>

          <div v-if="criteria.length" class="criteria">
            <h4>四项得分</h4>
            <div v-for="[name, item] in criteria" :key="name" class="criterion">
              <n-flex justify="space-between" align="center">
                <b>{{ name }}</b>
                <n-tag :type="percentType(item.score / item.max)" size="small" round>
                  {{ item.score || 0 }} / {{ item.max }}
                </n-tag>
              </n-flex>
              <n-text v-if="item.comment" depth="3" class="comment">{{ item.comment }}</n-text>
            </div>
          </div>

          <n-button v-if="canvasDiffers" secondary class="load" @click="loadToCanvas">
            把这一版载回画布
          </n-button>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.flowchart-result {
  padding-bottom: 16px;
}

.block {
  margin-bottom: 14px;
}

.empty {
  margin-top: 48px;
}

.note {
  font-size: 13px;
  opacity: 0.75;
  margin: 2px 0 0;
}

.pad {
  padding: 16px 0;
}

.history {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 2px 8px;
}

.attempt {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 58px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.attempt b {
  font-size: 17px;
  font-variant-numeric: tabular-nums;
}

.attempt-no {
  font-size: 11px;
  opacity: 0.65;
}

.attempt.success b {
  color: #18a058;
}

.attempt.warning b {
  color: #f0a020;
}

.attempt.error b {
  color: #d03050;
}

.attempt.active {
  border-color: #2080f0;
  box-shadow: 0 0 0 1px #2080f0;
}

.score {
  font-size: 22px;
  font-weight: 700;
}

.pass {
  margin: 10px 0 4px;
  padding: 8px 12px;
  border-radius: 6px;
  background-color: rgba(24, 160, 88, 0.1);
}

.feedback {
  margin: 12px 0;
  line-height: 1.7;
}

h4 {
  margin: 14px 0 6px;
  font-size: 14px;
}

.suggestions ol {
  margin: 0;
  padding-left: 1.4em;
  line-height: 1.7;
}

.criterion {
  padding: 6px 0;
}

.criterion + .criterion {
  border-top: 1px dashed rgba(128, 128, 128, 0.2);
}

.comment {
  display: block;
  margin-top: 2px;
  font-size: 13px;
}

.load {
  margin-top: 14px;
}
</style>
