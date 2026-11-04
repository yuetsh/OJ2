<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { isSqlProblem, parseFlowDoc } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { useProblemStore } from 'oj/store/problem'
import { DIFFICULTY } from 'utils/constants'
import { getTagColor } from 'utils/functions'
import { useSubmissionStore } from 'oj/store/submission'
import Markdown from 'shared/components/Markdown.vue'
import SqlProblemData from './SqlProblemData.vue'
import SimilarProblems from './SimilarProblems.vue'
import SampleList from './SampleList.vue'
import SectionHead from './SectionHead.vue'
import { tidyStatement } from '../utils/statement'
import { isFlowchartPass, useFlowchartStore } from 'oj/store/flowchart'
import { useMyFlowchartStore } from 'shared/store/myFlowchart'
import { useUserStore } from 'shared/store/user'
import { useProblemPageContext } from '../composables/problemPageContext'
import { useBackClose } from 'shared/composables/backClose'
import { useBreakpoints } from 'shared/composables/breakpoints'

const ProblemFlowchart = defineAsyncComponent(() => import('./ProblemFlowchart.vue'))
const FlowchartView = defineAsyncComponent(() => import('shared/components/FlowchartEditor/FlowchartView.vue'))
const MyFlowchart = defineAsyncComponent(() => import('./MyFlowchart.vue'))

const theme = useThemeVars()
const problemStore = useProblemStore()
const { problem } = storeToRefs(problemStore)
const ctx = useProblemPageContext()

// SQL 题：隐藏输入/输出/例子，改为渲染数据表与期望结果
const isSQL = computed(() => !!problem.value && isSqlProblem(problem.value))

// 相似题推荐：做对了、或者错了 3 次以上才给（比赛、专题里不给，见 problemPageContext）
const showSimilar = computed(() => ctx.value.similar && (problem.value?.myStatus === 0 || problemStore.failCount >= 3))

/**
 * 标题下的状态标签。原来是题面最上面两条整宽的提示（「本题已经被你解决啦」「尝试过但还没有
 * 通过」），占掉一屏里最值钱的那几行。专题里不给（入口差异表）。
 */
const myStatus = computed(() => {
  if (!ctx.value.statusTag || !userStore.isAuthed) return null
  const status = problem.value?.myStatus
  // 设计稿：没交过也写一个「还没交过」，状态这一格始终在
  if (status === undefined || status === null) return 'none'
  return status === 0 ? 'solved' : 'tried'
})

// 不写「限时 1 秒 / 内存 256MB」：中职学生看了只会犯迷糊，超时、超内存判出来时结果页签里自有说明

// ==================== 流程图小节 ====================
// 老师给的参考图（showFlowchart）和学生自己画到 A/S 的那张（allowFlowchart）只会有一个：
// 两个开关在后台是互斥的（admin/problem/detail.vue）；后端在 allowFlowchart 为真时会把
// mermaidCode 置成 null，不能把标准答案下发给正要自己画图的学生。
const canShowReferenceFlowchart = computed(() => !!problem.value?.showFlowchart && !!problem.value?.mermaidCode)
/**
 * 参考图用画流程图那套排法画（设计稿「参考流程图」C）。只有手写 Mermaid、没有结构树的老图
 * （恢复老备份才会有）退回 Mermaid
 */
const referenceDoc = computed(() => {
  const doc = parseFlowDoc(problem.value?.flowchartData)
  return doc?.steps.length ? doc : null
})
/** 点开放大看。手机上弹框是整屏的，按返回先关它 */
const referenceZoom = ref(false)
const { isMobile } = useBreakpoints()
useBackClose(referenceZoom, isMobile)
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

/**
 * 标题下的「流程图 X 级」：评完过的里面最好的那一次。画到 A / S 是绿的（算做完了），
 * 没画到是橙的 —— 原来只在 A / S 时才写，画到 C 的学生标题下是「还没交过」，像是什么都没交
 */
const flowchartGrade = computed(() => {
  const best = flowchartStore.scores.reduce<(typeof flowchartStore.scores)[number] | null>((acc, row) => (!acc || row.score > acc.score ? row : acc), null)
  return best?.grade ?? ''
})
const flowchartPassed = computed(() => isFlowchartPass(flowchartGrade.value))

// 这道题能画流程图，就去查画到 A/S 没有 —— 原来要先切到「流程图」这门「语言」才查。
// 不看 canDraw：手机上画不了，但以前在电脑上画好的那张照样该摆出来
watch(
  () => [problem.value?.id, !!problem.value?.allowFlowchart && ctx.value.entry !== 'contest', userStore.isAuthed] as const,
  ([id, drawable, authed]) => {
    if (id && drawable && authed) flowchartStore.ensureLoaded()
  },
  { immediate: true },
)

// 例子只是摆出来（SampleList）。试跑统一走工具栏的「运行例子」和结果页签的「自己输入」
const samples = computed(() => problem.value?.samples ?? [])
const submissionStore = useSubmissionStore()

/** 描述、输入、输出、提示：去掉老师为了隔开敲的空段落（见 utils/statement） */
const statement = computed(() => ({
  description: tidyStatement(problem.value?.description),
  input: tidyStatement(problem.value?.inputDescription),
  output: tidyStatement(problem.value?.outputDescription),
  hint: tidyStatement(problem.value?.hint),
}))

// 文案和配色分类都由后端生成 —— 原来这里有一份 NODE_TARGET_LABELS +
// ruleDescription + ruleTagType，和判题机那份几乎一模一样，见契约
// astRequirementSchema。规则原文（engine / target）不下发给学生。
// 每条规则前面一个小图标说是哪一类，规则的字照后端给的原样写（里面已经有「必须 / 不能」）
const KIND_ICON = {
  require: 'ph:check-circle-fill',
  forbid: 'ph:prohibit-fill',
  count: 'ph:hash-bold',
} as const

const astRequirements = computed(() => Object.entries(problem.value?.astRequirements ?? {}))
</script>
<template>
  <div v-if="problem" class="problem-content">
    <!-- 题号、题名、难度和状态一行（设计稿「题目页观感」定稿）。题名太长折到下一行，标签留在右边 -->
    <header class="problem-head">
      <span class="pid">{{ problem._id }}</span>
      <h1 class="problem-title">{{ problem.title }}</h1>
      <div class="meta">
        <n-tag v-if="problem.difficulty" size="small" :bordered="false" :type="getTagColor(problem.difficulty)">
          {{ DIFFICULTY[problem.difficulty] }}
        </n-tag>
        <n-tag v-if="myStatus === 'solved'" size="small" type="success" :bordered="false" class="solved"> 已解决 </n-tag>
        <!-- 流程图画到 A / S 就算做完了（决定 4）：别在「流程图 A 级」旁边再写「还没交过」
             「做过，还没对」—— 那两个说的是代码。图没画到 A 的，代码交过没对照写；没交过代码就不写
             「还没交过」，旁边的「流程图 C 级」已经说了交过什么。
             「做过，还没对」用红色：橙色和「中等」撞色，两个标签挨着分不出来 -->
        <template v-else-if="!flowchartPassed">
          <n-tag v-if="myStatus === 'tried'" size="small" type="error" :bordered="false"> 做过，还没对 </n-tag>
          <n-tag v-else-if="myStatus === 'none' && !flowchartGrade" size="small" :bordered="false">还没交过</n-tag>
        </template>
        <n-tag v-if="flowchartGrade" size="small" :type="flowchartPassed ? 'success' : 'warning'" :bordered="false"> 流程图 {{ flowchartGrade }} 级 </n-tag>
      </div>
    </header>

    <!-- 语法要求（AST 规则）放在最前面：它是硬性的判定条件，写到一半才看见就晚了。
         黄色，和提示同色；每条一行，前面的小图标说是「必须 / 不能 / 次数」哪一类 -->
    <section v-if="astRequirements.length > 0" class="block">
      <SectionHead icon="rules" tone="amber">语法要求</SectionHead>
      <template v-for="[lang, rules] in astRequirements" :key="lang">
        <div v-if="astRequirements.length > 1" class="lang-label">{{ lang }}</div>
        <ul class="rules">
          <li v-for="(rule, i) in rules" :key="`${lang}-${i}`" :class="rule.kind">
            <Icon :icon="KIND_ICON[rule.kind]" :width="16" class="rule-icon" aria-hidden="true" />
            <span>{{ rule.description }}</span>
          </li>
        </ul>
      </template>
    </section>

    <section class="block">
      <SectionHead icon="description">描述</SectionHead>
      <Markdown html :content="statement.description" />
    </section>

    <!-- 输入、输出上下排：并排的时候多一两句就挤成窄条（2020 的输入折成三行），旁边一栏空着 -->
    <template v-if="!isSQL">
      <section class="block">
        <SectionHead icon="input">输入</SectionHead>
        <Markdown html :content="statement.input" />
      </section>
      <section class="block">
        <SectionHead icon="output">输出</SectionHead>
        <Markdown html :content="statement.output" />
      </section>
    </template>

    <!-- 自己画到 A/S 的那张：默认展开一小块，可以放大、可以收起 -->
    <section v-if="!canShowReferenceFlowchart && myFlowchartStore.showing" class="block">
      <SectionHead icon="flowchart">
        你画的流程图
        <template #extra>
          <n-button text type="primary" @click="myFlowchartZoom = true">放大看 ›</n-button>
          <n-button text type="primary" @click="myFlowchartOpen = !myFlowchartOpen">
            {{ myFlowchartOpen ? '收起' : '展开' }}
          </n-button>
        </template>
      </SectionHead>
      <div v-if="myFlowchartOpen" class="my-flowchart" role="button" aria-label="放大看你画的流程图" @click="myFlowchartZoom = true">
        <MyFlowchart compact />
      </div>
      <n-modal v-model:show="myFlowchartZoom" preset="card" title="你画的流程图" :style="{ maxWidth: '900px' }">
        <MyFlowchart />
      </n-modal>
    </section>

    <section v-if="!isSQL && samples.length" class="block">
      <SectionHead icon="samples">
        例子
        <template #extra>
          <n-button text type="primary" @click="submissionStore.revealResult('custom')">自己输入数据试试 ›</n-button>
        </template>
      </SectionHead>
      <SampleList :samples="samples" />
    </section>

    <SqlProblemData v-if="isSQL && problem.sqlDisplay" :display="problem.sqlDisplay" :order-sensitive="!!problem.sqlConfig?.order_sensitive">
      <template #title="{ text }">
        <SectionHead :icon="text === '数据表' ? 'table' : 'expected'" class="sql-head">{{ text }}</SectionHead>
      </template>
    </SqlProblemData>

    <!--
      老师给的参考流程图：默认摊开，放在例子后面（设计稿「参考流程图」C）。原来在例子前面、
      折成一条要点开 —— 摊开放前面的话，长图（1056 有一千来像素高）会把例子挤出第一屏
    -->
    <section v-if="canShowReferenceFlowchart" class="block">
      <SectionHead icon="flowchart">
        参考流程图
        <template #extra>
          <n-button text type="primary" @click="referenceZoom = true">放大看 ›</n-button>
        </template>
      </SectionHead>
      <div
        class="reference-flowchart"
        role="button"
        tabindex="0"
        aria-label="放大看参考流程图"
        @click="referenceZoom = true"
        @keydown.enter="referenceZoom = true"
      >
        <FlowchartView v-if="referenceDoc" :doc="referenceDoc" />
        <ProblemFlowchart v-else />
      </div>
      <n-modal v-model:show="referenceZoom" preset="card" title="参考流程图" :style="{ maxWidth: '1000px' }">
        <FlowchartView v-if="referenceDoc" :doc="referenceDoc" zoomed />
        <ProblemFlowchart v-else />
      </n-modal>
    </section>

    <section v-if="statement.hint" class="block">
      <SectionHead icon="hint" tone="amber">提示</SectionHead>
      <Markdown html :content="statement.hint" />
    </section>

    <SimilarProblems v-if="showSimilar" title="相似题目推荐" place="content" />

    <!-- 来源不单起一节：学生做题用不上它，缩成最底下一行灰字 -->
    <footer v-if="problem.source" class="source">
      <span class="source-label">来源</span>
      <Markdown html :content="problem.source" class="source-text" />
    </footer>
  </div>
</template>

<style scoped>
.problem-content {
  container: problem-content / inline-size;
}

/* 题号 | 题名 | ……… | 难度 状态 */
.problem-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.pid {
  flex: none;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: v-bind('theme.textColor3');
}

.problem-title {
  margin: 0;
  min-width: 0;
  font-size: 22px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.meta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: center;
}

/* 「已解决」实心绿：做完了要一眼看得出 */
.meta .solved {
  background-color: v-bind('theme.successColor');
  color: #fff;
  font-weight: 600;
}

.block {
  margin-top: 20px;
}

/* 题面里老师自己写的标题（2020 开头的「鸣潮公式」是 h1）：降成和正文一样大的粗体，
   不然比题名还大，顶在「描述」下面像另起了一道题 */
.problem-content :deep(.oj-markdown :is(h1, h2, h3, h4, h5, h6)) {
  margin: 0.8em 0 0.3em;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.5;
}

/* 语法要求：每条一行 */
.lang-label {
  margin: 6px 0 2px;
  font-size: 14px;
  font-weight: 600;
}

.rules {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 16px;
  line-height: 1.6;
}

.rules li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.rule-icon {
  flex: none;
  margin-top: 0.3em;
}

.rules .require .rule-icon {
  color: v-bind('theme.successColor');
}

.rules .forbid .rule-icon {
  color: v-bind('theme.errorColor');
}

.rules .count .rule-icon {
  color: v-bind('theme.infoColor');
}

/* SQL 的「数据表 / 期望结果」和别的小节一样隔开 */
.sql-head {
  margin-top: 20px;
}

/* 参考流程图：和例子的输入格同一种浅灰底 */
.reference-flowchart {
  cursor: zoom-in;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.14);
  background-color: rgba(128, 128, 128, 0.05);
  padding: 16px 12px;
}

.my-flowchart {
  cursor: zoom-in;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.14);
  background-color: rgba(128, 128, 128, 0.05);
  padding: 8px;
}

.source {
  margin-top: 24px;
  padding-top: 10px;
  border-top: 1px solid v-bind('theme.dividerColor');
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: v-bind('theme.textColor3');
}

.source-label {
  flex: none;
}

.source-text {
  min-width: 0;
  font-size: 13px;
  line-height: 1.6;
}
</style>
