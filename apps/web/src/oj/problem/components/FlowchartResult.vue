<script setup lang="ts">
import { useThemeVars } from "naive-ui"
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
const theme = useThemeVars()
// 暗色主题的成功色是浅薄荷绿，上面的白字看不清
const isDark = useDark()
const passText = computed(() => (isDark.value ? "rgba(0, 0, 0, 0.85)" : "#fff"))

/** 正在看的那一次：点过哪次就是哪次，否则是最新的 */
const current = computed(() => {
  const id = selectedId.value ?? scores.value.at(-1)?.id
  return id ? (scores.value.find((row) => row.id === id) ?? null) : null
})
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
  if (ratio >= 0.6) return "success"
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
  <!-- 设计稿「画流程图：画布占满右栏，AI 点评在左边」「流程图评分中」 -->
  <div class="flowchart-result">
    <n-empty
      v-if="!scores.length && phase !== 'evaluating'"
      class="empty"
      description="还没交过流程图。画好之后点「交给 AI 点评」，评分和建议会出现在这里"
    />

    <!-- 历次分数连成一条：一眼看出是不是越改越好；正在评的那次是虚线框 -->
    <div v-if="scores.length || phase === 'evaluating'" class="history">
      <span class="history-lead"
        >AI 点评 · 画过 {{ scores.length + (phase === "evaluating" ? 1 : 0) }} 次：</span
      >
      <template v-for="(row, index) in scores" :key="row.id">
        <span v-if="index > 0" class="arrow" aria-hidden="true">→</span>
        <button
          type="button"
          class="attempt"
          :class="{
            pass: isFlowchartPass(row.grade),
            active: current?.id === row.id && !(phase === 'evaluating' && viewingLatest),
          }"
          :title="`第 ${index + 1} 次 · ${parseTime(row.createTime, 'MM-DD HH:mm')}`"
          @click="flowchartStore.select(index === scores.length - 1 ? null : row.id)"
        >
          {{ row.grade }} {{ row.score }}
        </button>
      </template>
      <template v-if="phase === 'evaluating'">
        <span v-if="scores.length" class="arrow" aria-hidden="true">→</span>
        <span class="attempt pending">第 {{ scores.length + 1 }} 次</span>
      </template>
    </div>
    <p v-if="hiddenCount" class="note">
      另外 {{ hiddenCount }} 次是加入题单之前画的，先藏起来了：在题单里画到 A 或 S 就解锁
    </p>

    <!-- 正在评：评的是最新这一次，所以只在看最新时显示 -->
    <template v-if="phase === 'evaluating' && viewingLatest">
      <div class="grading">
        <n-spin :size="26" />
        <div>
          <div class="grading-title">AI 正在看你的图</div>
          <div class="grading-note">一般 5 秒左右。可以先去看题目，评完这里会亮起来</div>
        </div>
      </div>
      <p class="note">评的时候画布上还能改，改了不影响这一次的分数</p>
    </template>

    <div v-else-if="phase === 'failed' && viewingLatest" class="failed">
      AI 这次没评出来，再点一次「交给 AI 点评」试试
    </div>

    <section v-else-if="current" class="current">
      <div class="score-line">
        <span class="score" :class="gradeType(current.grade)">{{ current.score }}</span>
        <span class="score-unit">分</span>
        <span class="grade" :class="gradeType(current.grade)">{{ current.grade }} 级</span>
        <span v-if="detail?.aiFeedback || isFlowchartPass(current.grade)" class="feedback">
          {{ detail?.aiFeedback ?? ""
          }}{{ isFlowchartPass(current.grade) ? " 这道题算做完了。" : "" }}
        </span>
      </div>

      <n-flex v-if="detailLoading && !detail" justify="center" class="pad">
        <n-spin size="small" />
      </n-flex>

      <template v-if="detail">
        <div v-if="criteria.length" class="criteria">
          <div v-for="[name, item] in criteria" :key="name" class="criterion">
            <div class="criterion-head">
              <b>{{ name }}</b>
              <span class="criterion-score">{{ item.score || 0 }} / {{ item.max }}</span>
            </div>
            <div class="bar">
              <div
                class="bar-fill"
                :class="percentType(item.score / item.max)"
                :style="{ width: `${Math.min(100, ((item.score || 0) / item.max) * 100)}%` }"
              />
            </div>
            <div v-if="item.comment" class="comment">{{ item.comment }}</div>
          </div>
        </div>

        <div v-if="suggestions.length" class="suggestions">
          <div class="suggestions-title">还可以改进</div>
          <div v-for="(line, index) in suggestions" :key="index" class="suggestion">
            <span v-if="index === 0" class="tag">重点</span>
            <span>{{ line }}</span>
          </div>
        </div>

        <div class="actions">
          <n-button
            v-if="isFlowchartPass(current.grade) && canCode"
            type="primary"
            size="large"
            @click="goCode"
          >
            照着它写代码 →
          </n-button>
          <n-button v-if="canvasDiffers" secondary @click="loadToCanvas">把这一版载回画布</n-button>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.flowchart-result {
  padding-bottom: 16px;
}

.empty {
  margin-top: 48px;
}

.note {
  font-size: 13px;
  color: v-bind("theme.textColor3");
  margin: 0 0 10px;
}

.pad {
  padding: 16px 0;
}

.history {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}

.history-lead {
  color: v-bind("theme.textColor2");
}

.arrow {
  color: v-bind("theme.textColor3");
}

.attempt {
  height: 26px;
  box-sizing: border-box;
  padding: 0 9px;
  border-radius: 13px;
  border: 1px solid transparent;
  background-color: rgba(128, 128, 128, 0.12);
  color: v-bind("theme.textColor2");
  font: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.attempt.active {
  background-color: v-bind("theme.textColor2");
  color: v-bind("theme.cardColor");
  font-weight: 600;
}

.attempt.pass.active {
  background-color: v-bind("theme.successColor");
  color: v-bind("passText");
}

.attempt.pending {
  display: inline-flex;
  align-items: center;
  cursor: default;
  background: transparent;
  border: 1px dashed v-bind("theme.successColor");
  color: v-bind("theme.successColorPressed");
}

.grading {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  margin-bottom: 10px;
  border-radius: 8px;
  background-color: rgba(24, 160, 88, 0.07);
  border: 1px solid rgba(24, 160, 88, 0.25);
}

.grading-title {
  font-size: 16px;
  font-weight: 700;
}

.grading-note {
  margin-top: 2px;
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.failed {
  padding: 12px 14px;
  border-radius: 6px;
  background-color: rgba(240, 160, 32, 0.1);
  border: 1px solid rgba(240, 160, 32, 0.35);
}

.score-line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-bottom: 14px;
}

.score {
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.score.success {
  color: v-bind("theme.successColorPressed");
}

.score.warning {
  color: v-bind("theme.warningColorPressed");
}

.score.error {
  color: v-bind("theme.errorColorPressed");
}

.score-unit {
  color: v-bind("theme.textColor2");
}

.grade {
  align-self: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background-color: v-bind("theme.errorColor");
}

.grade.success {
  background-color: v-bind("theme.successColor");
  color: v-bind("passText");
}

.grade.warning {
  background-color: v-bind("theme.warningColor");
}

.feedback {
  flex: 1 1 200px;
  align-self: center;
  margin-left: 6px;
  font-size: 14px;
  line-height: 1.6;
}

/* 四项得分：两列，每项一条进度 */
.criteria {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin-bottom: 14px;
}

.criterion-head {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}

.criterion-score {
  font-variant-numeric: tabular-nums;
  color: v-bind("theme.textColor2");
}

.bar {
  height: 6px;
  margin: 4px 0;
  border-radius: 3px;
  background-color: rgba(128, 128, 128, 0.14);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
  background-color: v-bind("theme.successColor");
}

.bar-fill.warning {
  background-color: v-bind("theme.warningColor");
}

.bar-fill.error {
  background-color: v-bind("theme.errorColor");
}

.comment {
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.suggestions {
  padding: 12px 14px;
  margin-bottom: 14px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.06);
  border: 1px solid v-bind("theme.dividerColor");
}

.suggestions-title {
  font-weight: 600;
  margin-bottom: 6px;
}

.suggestion {
  display: flex;
  align-items: baseline;
  gap: 8px;
  line-height: 1.7;
}

.tag {
  flex: none;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 12px;
  background-color: rgba(240, 160, 32, 0.16);
  color: v-bind("theme.warningColorPressed");
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
