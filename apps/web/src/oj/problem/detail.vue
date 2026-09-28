<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { errorCode } from "utils/api"
import { getProblem } from "oj/api"
import { useBreakpoints } from "shared/composables/breakpoints"
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useMyFlowchartStore } from "shared/store/myFlowchart"
import { useUserStore } from "shared/store/user"
import { useSubmissionStore } from "oj/store/submission"
import { useFlowchartStore } from "oj/store/flowchart"
import { useCollabStore } from "shared/store/collab"
import type { RouteLocationNormalized } from "vue-router"
// 判完之后该发生的事（烟花、点评、回题单）。静态引入：它得在第一次判完之前就挂好
import SubmissionEffects from "./components/SubmissionEffects.vue"
import ResultTabLabel from "./components/ResultTabLabel.vue"
import ContextBar from "./components/ContextBar.vue"
import StatisticsModal from "./components/StatisticsModal.vue"
import { useEditorMenu } from "./composables/editorMenu"
import {
  DRAWER_TITLE,
  useProblemPageContext,
  type ProblemDrawer as DrawerKey,
} from "./composables/problemPageContext"
import { useTeacherCollab } from "./composables/teacherCollab"

// 抽成具名 loader，便于进页面时与接口并行预取编辑器 chunk。
// 题库、比赛、题单三种入口用的是同一个编辑器：原来比赛和题单用的是另一个精简版，
// 没有协作、也没有错误标记，于是题单里「求助」老师接不上、「把中文标点都换成英文」
// 点了没反应（见 docs/specs/2026-09-28-problem-page-redesign-design.md 第 10 节）
const loadProblemEditor = () => import("./components/ProblemEditor.vue")
const ProblemEditor = defineAsyncComponent(loadProblemEditor)
const ProblemContent = defineAsyncComponent(() => import("./components/ProblemContent.vue"))
const ProblemDrawer = defineAsyncComponent(() => import("./components/ProblemDrawer.vue"))
const ResultPane = defineAsyncComponent(() => import("./components/ResultPane.vue"))
const MobileActionBar = defineAsyncComponent(() => import("./components/MobileActionBar.vue"))

interface Props {
  problemID: string
  contestID?: string
  problemSetId?: string
}

const { problemID, contestID = "" } = defineProps<Props>()

const errMsg = ref("无数据")
const route = useRoute()
const router = useRouter()

const problemStore = useProblemStore()
const myFlowchartStore = useMyFlowchartStore()
const { problem } = storeToRefs(problemStore)
const ctx = useProblemPageContext()

const { isMobile, isDesktop } = useBreakpoints()

/**
 * 左栏只有「题目 / 结果」两个页签（手机上编辑器也是一个页签，排在中间）。
 * 原来的六个页签里，流程图并进了「题目」，统计 / 点评 / 我的提交收进了抽屉 ——
 * 见 docs/specs/2026-09-28-problem-page-redesign-design.md 第 4 节。
 */
const tabOptions = computed(() =>
  isMobile.value ? ["content", "editor", "result"] : ["content", "result"],
)

const currentTab = ref("content")

watch(
  [() => route.query.tab, () => tabOptions.value],
  ([rawTab]) => {
    const tabs = tabOptions.value
    const fallback = tabs[0] ?? "content"
    currentTab.value = tabs.includes(rawTab as string) ? (rawTab as string) : fallback
  },
  { immediate: true },
)

watch(currentTab, (tab) => {
  if (!tabOptions.value.includes(tab) || route.query.tab === tab) return
  router.replace({
    query: { ...route.query, tab },
  })
})

// 「结果」第一次切过去才挂（它带着 DataTable 和 Markdown 渲染），挂上之后切走也不卸载：
// 挂着的错误说明在编辑器里标着红，AI 提示也在渲染
const resultMounted = ref(false)
watch(
  currentTab,
  (tab) => {
    if (tab === "result") resultMounted.value = true
  },
  { immediate: true },
)

const drawer = ref<DrawerKey | null>(null)
// 抽屉挂进左栏：要等左栏这个元素挂上之后才能当 Teleport 的目标
const leftPane = useTemplateRef<HTMLElement>("leftPane")
const theme = useThemeVars()

// 协作中的老师看的是学生的提交
const teacherCollab = useTeacherCollab()
const drawerLabel = (key: DrawerKey) =>
  key === "submission" && teacherCollab.value ? "他的提交" : DRAWER_TITLE[key]

function toggleDrawer(key: DrawerKey) {
  drawer.value = drawer.value === key ? null : key
}

/**
 * 手机页签行的「⋯」：统计 / 点评 / 我的提交，分隔线，再是编辑器的「更多」那几项
 * （去自测猫、复制、重置……）。原来后面这几项在「代码」页签的工具栏里，得先切过去才点得到
 */
const editorMenu = useEditorMenu(computed(() => false))
const drawerMenu = computed<DropdownOption[]>(() => {
  const drawers: DropdownOption[] = ctx.value.drawers.map((key) => ({
    label: drawerLabel(key),
    key,
  }))
  const editor = editorMenu.options.value
  if (drawers.length && editor.length) drawers.push({ type: "divider", key: "divider" })
  return [...drawers, ...editor]
})

function onMobileMenu(key: string) {
  if (editorMenu.select(key)) return
  toggleDrawer(key as DrawerKey)
}

// 交上去、或者语法检查没过：切到「结果」，抽屉开着就先关掉。提交按钮在编辑器那边，页签归这一页管
const submissionStore = useSubmissionStore()
watch(
  () => submissionStore.resultSeq,
  () => {
    drawer.value = null
    currentTab.value = "result"
  },
)

/**
 * 学生正在排队求助、或者老师正在帮他时换题：协作是开在这道题上的，换题就断了
 * （SyncCodeEditor 的 detach），排队的求助也跟着撤掉。先问一句，别让他一点「下一题」
 * 就把正在帮他的老师踢出去。只拦「离开这道题」，切页签改 `?tab=` 不算
 */
const collabStore = useCollabStore()
const dialog = useDialog()
/**
 * 已经同意过要去的地方。通过之后 1.5 秒内点「下一题」：这里先问一次，接着被强制点评拦下
 * （SubmissionEffects 的 holdForReview），评完再 push 同一个地址 —— 不记着的话会再问一遍，
 * 第二次点「留在这道题」就成了同意换题之后又被留下
 */
let approvedTarget: string | null = null
function confirmLeavingHelp(to: RouteLocationNormalized, from: RouteLocationNormalized) {
  if (collabStore.isTeacher || collabStore.helpStatus === "idle") return true
  if (to.name === from.name && to.params.problemID === from.params.problemID) return true
  if (approvedTarget === to.fullPath) {
    approvedTarget = null
    return true
  }
  const active = collabStore.helpStatus === "active"
  return new Promise<boolean>((resolve) => {
    dialog.warning({
      title: active ? "老师正在帮你看这道题" : "你正在排队等老师",
      content: active
        ? "换题之后，老师那边的协作就断了。确定要换吗？"
        : "换题之后这次举手就撤掉了，要在新的题目里重新举手。确定要换吗？",
      positiveText: "换题",
      negativeText: "留在这道题",
      onPositiveClick: () => {
        approvedTarget = to.fullPath
        resolve(true)
      },
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false),
    })
  })
}
onBeforeRouteUpdate(confirmLeavingHelp)
onBeforeRouteLeave(confirmLeavingHelp)
// 到了就作废：没被点评拦下、一次就换过去的，不能留着让下次去同一道题时不再问
watch(
  () => route.fullPath,
  (path) => {
    if (path === approvedTarget) approvedTarget = null
  },
)

// 结果页签的标题带状态图标（ResultTabLabel），n-tab-pane 的 tab 接受渲染函数
const resultTab = () => h(ResultTabLabel)

async function init() {
  // 「我的流程图」是上一道题的。这道题也画到了 A/S 的话，SubmitFlowchart 查完会再亮出来
  myFlowchartStore.hide()
  // 并行预取右侧编辑器 chunk（CodeMirror ~370K+），
  // 避免等 getProblem 返回后才串行下载，编辑器才迟迟出现
  loadProblemEditor()
  try {
    const res = await getProblem(problemID, contestID)
    problem.value = res
  } catch (err) {
    problem.value = null
    if (errorCode(err) === "contest-not-started") {
      errMsg.value = "比赛还没有开始"
    }
  }
}
onMounted(init)
watch(() => problemID, init)

// 题目详情里的 myStatus / myFailedCount 是按当前用户算的，而登录不重新挂载这个页面 ——
// 会话过期后直接在题目页登录的（机房里最常见的那条路）不补拉一次，AI 提示的解锁进度
// 就还是匿名时的 0，等于白改。只换 problem，不走 init：那里会把整页重来一遍。
watch(
  () => useUserStore().isAuthed,
  async (authed) => {
    if (!authed || !problem.value) return
    try {
      problem.value = await getProblem(problemID, contestID)
    } catch {
      // 拉不到就留着现在这份题面，不要把页面清空
    }
  },
)
onBeforeUnmount(() => {
  // 提交状态在 store 里、离开页面也不会自己没：不清的话回到题目页（哪怕换了一道题），
  // 结果面板里还是上一次的那条
  useSubmissionStore().reset()
  // 流程图那边同理，还在评的那次不再跟（照常评完落库）
  useFlowchartStore().reset()
  problem.value = null
  errMsg.value = "无数据"
  myFlowchartStore.hide()
})
</script>

<template>
  <template v-if="problem">
    <SubmissionEffects />
    <StatisticsModal />
    <!--
      桌面：两栏顶满整个内容区（设计稿「机房（方案 B）」），中间一条 1px 分隔线、可拖动。
      布局给内容区留了 16px 内边距，这里用负边距抵掉
    -->
    <n-split
      v-if="isDesktop"
      class="problem-split"
      direction="horizontal"
      :default-size="0.43"
      :min="0.2"
      :max="0.8"
      :resize-trigger-size="1"
    >
      <template #1>
        <div id="problem-left-pane" ref="leftPane" class="left-pane">
          <ContextBar />
          <div class="tab-row">
            <div class="page-tabs" role="tablist" aria-label="题目 / 结果">
              <button
                type="button"
                role="tab"
                class="page-tab"
                :class="{ active: currentTab === 'content' }"
                :aria-selected="currentTab === 'content'"
                @click="currentTab = 'content'"
              >
                题目
              </button>
              <button
                type="button"
                role="tab"
                class="page-tab"
                :class="{ active: currentTab === 'result' }"
                :aria-selected="currentTab === 'result'"
                @click="currentTab = 'result'"
              >
                <ResultTabLabel />
              </button>
            </div>
            <div v-if="ctx.drawers.length" class="drawer-buttons">
              <button
                v-for="key in ctx.drawers"
                :key="key"
                type="button"
                class="drawer-button"
                @click="toggleDrawer(key)"
              >
                {{ drawerLabel(key) }}
              </button>
            </div>
          </div>
          <!-- 两个页签各滚各的：读题读到底下切去看结果，结果不该也停在底下 -->
          <div v-show="currentTab === 'content'" class="pane-body">
            <n-scrollbar content-style="padding: 16px 20px">
              <ProblemContent />
            </n-scrollbar>
          </div>
          <div v-if="resultMounted" v-show="currentTab === 'result'" class="pane-body">
            <n-scrollbar content-style="padding: 14px 20px">
              <ResultPane />
            </n-scrollbar>
          </div>
          <!-- 抽屉盖住整个左栏（连上下文条和页签行），抽屉顶上有自己的页签可以互相切换；编辑器不动 -->
          <ProblemDrawer v-if="leftPane" v-model="drawer" :to="leftPane" />
        </div>
      </template>
      <template #2>
        <div class="right-pane">
          <ProblemEditor />
        </div>
      </template>
    </n-split>

    <!-- Mobile：底部固定「运行例子 / 提交」，内容底下留出它的高度 -->
    <div v-else class="mobile">
      <ContextBar />
      <n-tabs v-model:value="currentTab" type="segment">
        <n-tab-pane name="content" tab="题目">
          <ProblemContent />
        </n-tab-pane>
        <!--
          编辑器一直挂着（show，不是默认的 if）：底部的「提交」在三个页签下都能点，
          没切到过「代码」页签的话草稿就没读进来、按钮是灰的；切走就卸载还会丢掉撤销历史
        -->
        <n-tab-pane name="editor" tab="代码" display-directive="show">
          <ProblemEditor />
        </n-tab-pane>
        <n-tab-pane name="result" :tab="resultTab" display-directive="show:lazy">
          <ResultPane />
        </n-tab-pane>
        <template v-if="drawerMenu.length" #suffix>
          <n-dropdown trigger="click" :options="drawerMenu" @select="onMobileMenu">
            <n-button size="small" quaternary aria-label="更多：统计、点评、我的提交、复制代码……">
              ⋯
            </n-button>
          </n-dropdown>
        </template>
      </n-tabs>
      <ProblemDrawer v-model="drawer" />
      <MobileActionBar />
    </div>
  </template>
  <n-empty v-else :description="errMsg"></n-empty>
</template>

<style scoped>
.mobile {
  padding-bottom: calc(72px + env(safe-area-inset-bottom));
}

.problem-split {
  margin: -16px;
  width: calc(100% + 32px);
  height: calc(100vh - 60px);
}

/* 分隔线：看上去 1px，拖的时候热区宽一点 */
.problem-split :deep(.n-split__resize-trigger) {
  background-color: v-bind("theme.borderColor");
}

/* 热区挂在分隔线本身上：wrapper 不是定位元素，挂在它上面的 ::before 会盖住整个分栏 */
.problem-split :deep(.n-split__resize-trigger-wrapper) {
  position: relative;
}

.problem-split :deep(.n-split__resize-trigger-wrapper)::before {
  content: "";
  position: absolute;
  inset: 0 -4px;
  cursor: col-resize;
}

.left-pane {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.right-pane {
  height: 100%;
}

/* 「题目 / 结果」：下划线式页签，右边是抽屉的三个胶囊按钮 */
.tab-row {
  flex: none;
  height: 42px;
  box-sizing: border-box;
  padding: 0 20px 0 12px;
  display: flex;
  align-items: center;
  gap: 2px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.page-tabs {
  display: flex;
  height: 100%;
}

.page-tab {
  height: 42px;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  font: inherit;
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.page-tab.active {
  border-bottom-color: v-bind("theme.primaryColor");
  color: v-bind("theme.textColor1");
  font-weight: 600;
}

.drawer-buttons {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.drawer-button {
  height: 32px;
  padding: 0 11px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 16px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.drawer-button:hover {
  border-color: v-bind("theme.primaryColorHover");
  color: v-bind("theme.primaryColor");
}

.pane-body {
  flex: 1;
  min-height: 0;
}
</style>
