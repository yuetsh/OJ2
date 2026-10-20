<script setup lang="ts">
import { isSqlProblem, parseFlowDoc } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { DIFFICULTY } from "utils/constants"
import { copyToClipboard, getTagColor } from "utils/functions"
import { useSubmissionStore } from "oj/store/submission"
import Markdown from "shared/components/Markdown.vue"
import SqlProblemData from "./SqlProblemData.vue"
import SimilarProblems from "./SimilarProblems.vue"
import { isFlowchartPass, useFlowchartStore } from "oj/store/flowchart"
import { useMyFlowchartStore } from "shared/store/myFlowchart"
import { useUserStore } from "shared/store/user"
import { useProblemPageContext } from "../composables/problemPageContext"

const ProblemFlowchart = defineAsyncComponent(() => import("./ProblemFlowchart.vue"))
const FlowchartView = defineAsyncComponent(
  () => import("shared/components/FlowchartEditor/FlowchartView.vue"),
)
const MyFlowchart = defineAsyncComponent(() => import("./MyFlowchart.vue"))

const theme = useThemeVars()
const problemStore = useProblemStore()
const { problem } = storeToRefs(problemStore)
const ctx = useProblemPageContext()

// SQL 题：隐藏输入/输出/例子，改为渲染数据表与期望结果
const isSQL = computed(() => !!problem.value && isSqlProblem(problem.value))

// 相似题推荐：做对了、或者错了 3 次以上才给（比赛、题单里不给，见 problemPageContext）
const showSimilar = computed(
  () => ctx.value.similar && (problem.value?.myStatus === 0 || problemStore.failCount >= 3),
)

/**
 * 标题下的状态标签。原来是题面最上面两条整宽的提示（「本题已经被你解决啦」「尝试过但还没有
 * 通过」），占掉一屏里最值钱的那几行。题单里不给（入口差异表）。
 */
const myStatus = computed(() => {
  if (!ctx.value.statusTag || !userStore.isAuthed) return null
  const status = problem.value?.myStatus
  // 设计稿：没交过也写一个「还没交过」，状态这一格始终在
  if (status === undefined || status === null) return "none"
  return status === 0 ? "solved" : "tried"
})

// 不写「限时 1 秒 / 内存 256MB」：中职学生看了只会犯迷糊，超时、超内存判出来时结果页签里自有说明

// ==================== 流程图小节 ====================
// 老师给的参考图（showFlowchart）和学生自己画到 A/S 的那张（allowFlowchart）只会有一个：
// 两个开关在后台是互斥的（admin/problem/detail.vue）；后端在 allowFlowchart 为真时会把
// mermaidCode 置成 null，不能把标准答案下发给正要自己画图的学生。
const canShowReferenceFlowchart = computed(
  () => !!problem.value?.showFlowchart && !!problem.value?.mermaidCode,
)
/**
 * 参考图用画流程图那套排法画（设计稿「参考流程图」C）。只有手写 Mermaid、没有结构树的老图
 * （恢复老备份才会有）退回 Mermaid
 */
const referenceDoc = computed(() => {
  const doc = parseFlowDoc(problem.value?.flowchartData)
  return doc?.steps.length ? doc : null
})
const myFlowchartStore = useMyFlowchartStore()
const flowchartStore = useFlowchartStore()
const userStore = useUserStore()
const myFlowchartZoom = ref(false)
/** 自己画的那张默认展开、可以收起（设计稿「流程图 A 级之后」） */
const myFlowchartOpen = ref(true)
watch(
  () => problem.value?._id,
  () => (myFlowchartOpen.value = true),
)

/** 流程图画到 A / S 了：标题下给个「流程图 A 级」 */
const flowchartGrade = computed(() => {
  const passed = flowchartStore.scores.filter((row) => isFlowchartPass(row.grade))
  if (!passed.length) return ""
  return passed.some((row) => row.grade === "S") ? "S" : "A"
})

// 例子旁的「复制」：点完变成「已复制」一秒
const message = useMessage()
const copiedKey = ref("")
const { start: resetCopied } = useTimeoutFn(() => (copiedKey.value = ""), 1000, {
  immediate: false,
})
async function copySample(key: string, text: string) {
  if (await copyToClipboard(text)) {
    copiedKey.value = key
    resetCopied()
  } else {
    message.error("复制失败")
  }
}

// 这道题能画流程图，就去查画到 A/S 没有 —— 原来要先切到「流程图」这门「语言」才查。
// 不看 canDraw：手机上画不了，但以前在电脑上画好的那张照样该摆出来
watch(
  () =>
    [
      problem.value?.id,
      !!problem.value?.allowFlowchart && ctx.value.entry !== "contest",
      userStore.isAuthed,
    ] as const,
  ([id, drawable, authed]) => {
    if (id && drawable && authed) flowchartStore.ensureLoaded()
  },
  { immediate: true },
)

// 例子只是摆出来。原来每个例子旁有个「测试」按钮（结果只给通过 / 不通过、2 秒后复位），
// 现在试跑统一走工具栏的「运行例子」和结果页签的「自己输入」
const samples = computed(() => problem.value?.samples ?? [])
const submissionStore = useSubmissionStore()

const SAMPLE_SIDES = ["input", "output"] as const
const SAMPLE_SIDE_LABEL = { input: "输入", output: "输出" } as const

/*
 * 例子默认摆成「例子 N | 输入 | 输出」的表，可机房那两种屏上左栏只有 550px 左右，每格只放得下
 * 二十来个字符，而例子输出最长那行的 p90 就有 28 个字符宽（中文按两个算）—— 一成的题会在
 * 半格里横着滚。所以按这道题最长那行量一下：半格放得下就摆表，放不下这道题的例子就整体改成
 * 上下排（输入一行、输出一行，各占满宽）。整宽还放不下的二十来道才横着滚。不自动折行：折出来
 * 的行学生分不清是不是真换了行，照着它输出就错了。
 * 下面几个尺寸 CSS 里也用（v-bind），量宽度和排版是同一套数。
 */
const SAMPLE_FONT = "14px Consolas, Monaco, monospace"
const SAMPLE_NO_W = 56
const SAMPLE_GAP = 8
const SAMPLE_PAD_L = 10
const SAMPLE_PAD_R = 4
const SAMPLE_COPY_W = 44
const sampleCss = {
  font: SAMPLE_FONT,
  noW: `${SAMPLE_NO_W}px`,
  gap: `${SAMPLE_GAP}px`,
  pad: `2px ${SAMPLE_PAD_R}px 2px ${SAMPLE_PAD_L}px`,
  copyW: `${SAMPLE_COPY_W}px`,
}

let measureCtx: CanvasRenderingContext2D | null = null
/** 例子里最长那一行排出来有多宽（px）。等宽字体里中文、表情照样比英文宽，所以按字体真量 */
const sampleTextWidth = computed(() => {
  measureCtx ??= document.createElement("canvas").getContext("2d")
  if (!measureCtx) return 0
  measureCtx.font = SAMPLE_FONT
  let widest = 0
  for (const sample of samples.value) {
    for (const side of SAMPLE_SIDES) {
      for (const line of sample[side].split("\n")) {
        // <pre> 里 tab 按 8 列排
        const width = measureCtx.measureText(line.replace(/\t/g, "        ")).width
        if (width > widest) widest = width
      }
    }
  }
  return widest
})

const sampleTable = useTemplateRef<HTMLElement>("sampleTable")
const { width: sampleTableWidth } = useElementSize(sampleTable)
/**
 * 窄（手机，或桌面左栏拖到最窄）：「例子 N」不占一列，改成每个例子头上一行小字。
 * 390 宽的手机上那一列连同间距要吃掉 64px，框只剩一半多
 */
const sampleNarrow = computed(() => sampleTableWidth.value > 0 && sampleTableWidth.value < 480)
/** 摆成表时，半格里留给文字的宽度 */
const sampleHalfWidth = computed(
  () =>
    (sampleTableWidth.value - (sampleNarrow.value ? 0 : SAMPLE_NO_W + SAMPLE_GAP) - SAMPLE_GAP) /
      2 -
    SAMPLE_PAD_L -
    SAMPLE_PAD_R -
    SAMPLE_COPY_W,
)
const samplesStacked = computed(
  () => sampleTableWidth.value > 0 && sampleTextWidth.value > sampleHalfWidth.value,
)

// 文案和配色分类都由后端生成 —— 原来这里有一份 NODE_TARGET_LABELS +
// ruleDescription + ruleTagType，和判题机那份几乎一模一样，见契约
// astRequirementSchema。规则原文（engine / target）不下发给学生。
const KIND_TAG_TYPE = {
  require: "success",
  forbid: "error",
  count: "info",
} as const

const astRequirements = computed(() => Object.entries(problem.value?.astRequirements ?? {}))
</script>

<template>
  <div v-if="problem" class="problem-content">
    <header class="problem-head">
      <div class="title-row">
        <span class="pid">{{ problem._id }}</span>
        <h1 class="problem-title">{{ problem.title }}</h1>
      </div>
      <div class="meta">
        <n-tag
          v-if="problem.difficulty"
          size="small"
          :bordered="false"
          :type="getTagColor(problem.difficulty)"
        >
          {{ DIFFICULTY[problem.difficulty] }}
        </n-tag>
        <n-tag v-if="myStatus === 'solved'" size="small" type="success" :bordered="false">
          已解决
        </n-tag>
        <!-- 流程图画到 A / S 就算做完了（决定 4）：别在「流程图 A 级」旁边再写「还没交过」
             「做过，还没对」—— 那两个说的是代码 -->
        <template v-else-if="!flowchartGrade">
          <n-tag v-if="myStatus === 'tried'" size="small" type="warning" :bordered="false">
            做过，还没对
          </n-tag>
          <n-tag v-else-if="myStatus === 'none'" size="small" :bordered="false">还没交过</n-tag>
        </template>
        <n-tag v-if="flowchartGrade" size="small" type="success" :bordered="false">
          流程图 {{ flowchartGrade }} 级
        </n-tag>
      </div>
    </header>

    <!-- 语法要求（AST 规则）放在最前面：它是硬性的判定条件，写到一半才看见就晚了 -->
    <div v-if="astRequirements.length > 0" class="requirements">
      <span class="requirements-head">语法要求</span>
      <template v-for="[lang, rules] in astRequirements" :key="lang">
        <span v-if="astRequirements.length > 1" class="lang-label">{{ lang }}</span>
        <n-tag
          v-for="(rule, i) in rules"
          :key="`${lang}-${i}`"
          :type="KIND_TAG_TYPE[rule.kind]"
          size="small"
          :bordered="false"
        >
          {{ rule.description }}
        </n-tag>
      </template>
      <span class="requirements-note">提交时会逐条检查</span>
    </div>

    <section class="block">
      <h3 class="title">描述</h3>
      <Markdown html :content="problem.description" />
    </section>

    <!-- 输入、输出一般都只有一两句，左右摆开省半屏 -->
    <div v-if="!isSQL" class="io">
      <section class="block">
        <h3 class="title">输入</h3>
        <Markdown html :content="problem.inputDescription" />
      </section>
      <section class="block">
        <h3 class="title">输出</h3>
        <Markdown html :content="problem.outputDescription" />
      </section>
    </div>

    <!-- 自己画到 A/S 的那张：默认展开一小块，可以放大、可以收起 -->
    <section v-if="!canShowReferenceFlowchart && myFlowchartStore.showing" class="block">
      <div class="block-head">
        <h3 class="title">你画的流程图</h3>
        <n-button text type="primary" size="small" @click="myFlowchartZoom = true">
          放大看
        </n-button>
        <n-button text size="small" @click="myFlowchartOpen = !myFlowchartOpen">
          {{ myFlowchartOpen ? "收起" : "展开" }}
        </n-button>
      </div>
      <div
        v-if="myFlowchartOpen"
        class="my-flowchart"
        role="button"
        aria-label="放大看你画的流程图"
        @click="myFlowchartZoom = true"
      >
        <MyFlowchart compact />
      </div>
      <n-modal
        v-model:show="myFlowchartZoom"
        preset="card"
        title="你画的流程图"
        :style="{ maxWidth: '900px' }"
      >
        <MyFlowchart />
      </n-modal>
    </section>

    <template v-if="!isSQL">
      <!--
        例子是一张表：例子 N | 输入 | 输出。原来每个例子各占一个小标题加两个框，三个例子
        就占掉大半屏；Python 的例子大多一两行，摆成表一眼能对上「这个输入 → 这个输出」
      -->
      <section v-if="samples.length" class="block">
        <div class="block-head">
          <h3 class="title">例子</h3>
          <n-button
            text
            type="primary"
            size="small"
            class="block-link"
            @click="submissionStore.revealResult('custom')"
          >
            自己输入数据试试 ›
          </n-button>
        </div>
        <!-- 半格放不下最长那行就整体改成上下排，见 samplesStacked -->
        <div
          ref="sampleTable"
          class="sample-table"
          :class="{ stacked: samplesStacked, narrow: sampleNarrow }"
          role="table"
          aria-label="例子"
        >
          <div v-if="!samplesStacked" class="sample-row" role="row">
            <span v-if="!sampleNarrow" role="columnheader"></span>
            <span role="columnheader" class="sample-label">输入</span>
            <span role="columnheader" class="sample-label">输出</span>
          </div>
          <div v-for="(sample, index) of samples" :key="index" class="sample-row" role="row">
            <span class="sample-no" role="rowheader">例子 {{ index + 1 }}</span>
            <template v-for="side in SAMPLE_SIDES" :key="side">
              <span v-if="samplesStacked" class="sample-label sample-side">
                {{ SAMPLE_SIDE_LABEL[side] }}
              </span>
              <div class="sample-cell" role="cell">
                <pre class="testcase">{{ sample[side] }}</pre>
                <button
                  type="button"
                  class="sample-copy"
                  :aria-label="`复制例子 ${index + 1} 的${SAMPLE_SIDE_LABEL[side]}`"
                  @click="copySample(`${index}-${side}`, sample[side])"
                >
                  {{ copiedKey === `${index}-${side}` ? "已复制" : "复制" }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </section>
    </template>

    <SqlProblemData
      v-if="isSQL && problem.sqlDisplay"
      :display="problem.sqlDisplay"
      :order-sensitive="!!problem.sqlConfig?.order_sensitive"
    >
      <template #title="{ text }">
        <h3 class="title sql-title">{{ text }}</h3>
      </template>
    </SqlProblemData>

    <!--
      老师给的参考流程图：默认摊开，放在例子后面（设计稿「参考流程图」C）。原来在例子前面、
      折成一条要点开 —— 摊开放前面的话，长图（1056 有一千来像素高）会把例子挤出第一屏
    -->
    <section v-if="canShowReferenceFlowchart" class="block">
      <h3 class="title">参考流程图</h3>
      <div class="reference-flowchart">
        <FlowchartView v-if="referenceDoc" :doc="referenceDoc" />
        <ProblemFlowchart v-else />
      </div>
    </section>

    <section v-if="problem.hint" class="block">
      <h3 class="title">提示</h3>
      <Markdown html :content="problem.hint" />
    </section>

    <section v-if="problem.source" class="block">
      <h3 class="title">来源</h3>
      <Markdown html :content="problem.source" />
    </section>

    <SimilarProblems v-if="showSimilar" title="相似题目推荐" />
  </div>
</template>

<style scoped>
/* 设计稿「题目页签：还没运行过」 */
.problem-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.pid {
  flex: none;
  padding: 2px 8px;
  border-radius: 3px;
  background-color: rgba(128, 128, 128, 0.12);
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.problem-title {
  margin: 0;
  font-size: 22px;
  line-height: 1.3;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.block {
  margin-top: 18px;
}

.block-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.block-head .title {
  margin: 0;
}

.problem-content {
  container: problem-content / inline-size;
}

.block-link {
  margin-left: auto;
}

/*
 * 小节标题（描述 / 输入 / 输出 / 例子 / 提示……）。画板上是 15px 半粗，比 14px 的正文只大一号，
 * 一屏题面扫下来分不出哪是标题（用户 2026-09-29 提出）：加粗、大一号，左边一道主色竖条
 */
.title {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  margin: 0 0 6px;
  padding-left: 9px;
  border-left: 3px solid v-bind("theme.primaryColor");
}

.io {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

/* 窄的时候输入、输出上下排：并排的话长一点的说明挤成一字两行的窄条，旁边一栏空着 */
@container problem-content (max-width: 480px) {
  .io {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* 语法要求：一行的浅绿框，硬性的判定条件，放在最前面 */
.requirements {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid rgba(24, 160, 88, 0.3);
  background-color: rgba(24, 160, 88, 0.06);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  font-size: 13px;
}

.requirements-head {
  font-weight: 600;
}

.requirements-note {
  color: v-bind("theme.textColor3");
}

.lang-label {
  font-weight: 600;
}

/* 参考流程图：和例子的格子同一种浅灰底 */
.reference-flowchart {
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.05);
  padding: 16px 12px;
}

.my-flowchart {
  cursor: zoom-in;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.06);
  padding: 8px;
}

/*
 * 例子：例子 N | 输入 | 输出，每格右边一个「复制」。
 * 放不下时（.stacked）每个例子两行：例子 N | 输入 | 那格，下一行 输出 | 那格
 */
.sample-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sample-table.stacked {
  gap: 12px;
}

.sample-row {
  display: grid;
  grid-template-columns: v-bind("sampleCss.noW") minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px v-bind("sampleCss.gap");
  align-items: stretch;
}

.stacked .sample-row {
  grid-template-columns: v-bind("sampleCss.noW") 32px minmax(0, 1fr);
}

.sample-label,
.sample-no {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.sample-no {
  display: flex;
  align-items: center;
}

/* 上下排时「例子 N」竖跨输入、输出两行，和「输入」对齐在顶上 */
.stacked .sample-no {
  grid-row: span 2;
  align-items: flex-start;
}

.stacked .sample-no,
.sample-side {
  padding-top: 8px;
  line-height: 1.5;
}

/* 窄：「例子 N」占满一行当小标题，下面输入、输出（并排或上下排） */
.narrow .sample-row {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.narrow.stacked .sample-row {
  grid-template-columns: 32px minmax(0, 1fr);
}

.narrow .sample-no,
.narrow.stacked .sample-no {
  grid-column: 1 / -1;
  grid-row: auto;
  padding-top: 4px;
}

.sample-table.narrow {
  gap: 10px;
}

.sample-cell {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  padding: v-bind("sampleCss.pad");
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
}

.testcase {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 4px 0;
  font: v-bind("sampleCss.font");
  line-height: 1.5;
  white-space: pre;
  overflow-x: auto;
}

/* 整宽也放不下、只好横着滚的那二十来道：Windows 上默认那根带箭头的粗滚动条比例子本身还显眼 */
.testcase::-webkit-scrollbar {
  height: 6px;
}

.testcase::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background-color: rgba(128, 128, 128, 0.35);
}

.testcase::-webkit-scrollbar-track {
  background: transparent;
}

.sample-copy {
  flex: none;
  width: v-bind("sampleCss.copyW");
  height: 24px;
  margin-top: 2px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: v-bind("theme.primaryColorPressed");
  cursor: pointer;
}

.sample-copy:hover {
  background-color: rgba(24, 160, 88, 0.1);
}

.sql-title {
  margin-top: 14px;
}
</style>
