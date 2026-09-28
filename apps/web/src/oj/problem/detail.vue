<script setup lang="ts">
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

// 协作中的老师看的是学生的提交
const teacherCollab = useTeacherCollab()
const drawerLabel = (key: DrawerKey) =>
  key === "submission" && teacherCollab.value ? "他的提交" : DRAWER_TITLE[key]

function toggleDrawer(key: DrawerKey) {
  drawer.value = drawer.value === key ? null : key
}

const drawerMenu = computed<DropdownOption[]>(() =>
  ctx.value.drawers.map((key) => ({ label: drawerLabel(key), key })),
)

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
function confirmLeavingHelp(to: RouteLocationNormalized, from: RouteLocationNormalized) {
  if (collabStore.isTeacher || collabStore.helpStatus === "idle") return true
  if (to.name === from.name && to.params.problemID === from.params.problemID) return true
  const active = collabStore.helpStatus === "active"
  return new Promise<boolean>((resolve) => {
    dialog.warning({
      title: active ? "老师正在帮你看这道题" : "你正在排队等老师",
      content: active
        ? "换题之后，老师那边的协作就断了。确定要换吗？"
        : "换题之后这次举手就撤掉了，要在新的题目里重新举手。确定要换吗？",
      positiveText: "换题",
      negativeText: "留在这道题",
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false),
    })
  })
}
onBeforeRouteUpdate(confirmLeavingHelp)
onBeforeRouteLeave(confirmLeavingHelp)

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
    <n-split
      v-if="isDesktop"
      direction="horizontal"
      :default-size="0.43"
      :min="0.2"
      :max="0.8"
      style="height: calc(100vh - 92px)"
    >
      <template #1>
        <div class="left-pane">
          <ContextBar />
          <div class="tab-row">
            <n-tabs
              v-model:value="currentTab"
              type="segment"
              class="page-tabs"
              @click="drawer = null"
            >
              <n-tab name="content">题目</n-tab>
              <n-tab name="result"><ResultTabLabel /></n-tab>
            </n-tabs>
            <n-flex v-if="ctx.drawers.length" :size="6" :wrap="false">
              <n-button
                v-for="key in ctx.drawers"
                :key="key"
                size="small"
                :type="drawer === key ? 'primary' : 'default'"
                :secondary="drawer === key"
                @click="toggleDrawer(key)"
              >
                {{ drawerLabel(key) }}
              </n-button>
            </n-flex>
          </div>
          <!--
            抽屉挂在页签行下面这一块（position: relative），盖住题面、编辑器不动。
            页签行露在外面：同一个按钮再点一下就关、点另一个就换，点「题目 / 结果」也会关
          -->
          <div id="problem-pane-stack" class="pane-stack">
            <!--
              两个页签各滚各的：读题读到底下切去看结果，结果不该也停在底下。
              v-show 挂在外面这层 div 上 —— 直接挂在 n-scrollbar 上不生效，它自己管根节点的 style
            -->
            <div v-show="currentTab === 'content'" class="pane-body">
              <n-scrollbar content-style="padding-top: 8px">
                <ProblemContent />
              </n-scrollbar>
            </div>
            <div v-if="resultMounted" v-show="currentTab === 'result'" class="pane-body">
              <n-scrollbar content-style="padding-top: 8px">
                <ResultPane />
              </n-scrollbar>
            </div>
            <ProblemDrawer v-model="drawer" to="#problem-pane-stack" />
          </div>
        </div>
      </template>
      <template #2>
        <ProblemEditor />
      </template>
    </n-split>

    <!-- Mobile -->
    <template v-else>
      <ContextBar />
      <n-tabs v-model:value="currentTab" type="segment">
        <n-tab-pane name="content" tab="题目">
          <ProblemContent />
        </n-tab-pane>
        <n-tab-pane name="editor" tab="代码">
          <ProblemEditor />
        </n-tab-pane>
        <n-tab-pane name="result" :tab="resultTab" display-directive="show:lazy">
          <ResultPane />
        </n-tab-pane>
        <template v-if="drawerMenu.length" #suffix>
          <n-dropdown trigger="click" :options="drawerMenu" @select="toggleDrawer">
            <n-button size="small" quaternary aria-label="统计、点评、我的提交"> ⋯ </n-button>
          </n-dropdown>
        </template>
      </n-tabs>
      <ProblemDrawer v-model="drawer" />
    </template>
  </template>
  <n-empty v-else :description="errMsg"></n-empty>
</template>

<style scoped>
.left-pane {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-row {
  flex: none;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.page-tabs {
  width: 180px;
  flex: none;
}

.pane-stack {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.pane-body {
  height: 100%;
}
</style>
