<script setup lang="ts">
import { storeToRefs } from "pinia"
import type { RouteLocationNormalized } from "vue-router"
import { getReaction } from "oj/api"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"
import { useFireworks } from "oj/problem/composables/useFireworks"
import { useLessonStore } from "oj/store/lesson"
import { isFlowchartPass, useFlowchartStore } from "oj/store/flowchart"
import { SubmissionStatus } from "utils/constants"
import { useProblemPageContext } from "../composables/problemPageContext"

/**
 * 判完之后「该发生什么」：失败计数、标成已解决、烟花、点评、回题单。
 *
 * 挂在题目页这一层（detail.vue），和编辑器、提交按钮都无关 —— 原来这些写在提交按钮
 * 那个组件（SubmitCode）里，手机上切一下页签、桌面切一下分栏模式，编辑器一卸载它们
 * 就跟着没了：判完不放烟花、不计失败次数、不弹点评、题单里不回题单。
 * 状态本身在 submission store，这里只是看着它做事。
 */

const ProblemReaction = defineAsyncComponent(() => import("./ProblemReaction.vue"))

const problemStore = useProblemStore()
const submissionStore = useSubmissionStore()
const { problem } = storeToRefs(problemStore)
const { submission } = storeToRefs(submissionStore)

const router = useRouter()
const ctx = useProblemPageContext()

const { celebrate } = useFireworks()

// ==================== AC 后弹出点评 ====================
// 只对已经能评价、且还没评过的人弹：后端要求先有 AC 才收评价，这里刚 AC 完正好；
// mine 非 null 说明早就评过了，别再打扰。
//
// 点评是强制的，但从 AC 到弹窗出来有 1.5 秒（加上查一次「评过没有」），而换题会把
// 定时器取消（见下面换题的 watch）—— 「下一题」在通过的那一刻就出现了，学生手快点
// 下去，点评就跳过了。所以这段时间里欠着一次点评（reviewOwed），离开这道题的导航
// 先拦下来：立刻弹点评，选完再去原来要去的地方。
const commentPanel = ref(false)
const reviewOwed = ref(false)
let reviewChecking = false
let navigationAfterReview: string | null = null
// navigationAfterReview 是普通变量（守卫里改，不需要触发渲染），弹窗按钮的文案（「继续」）
// 要一个响应式的影子：拦下的那一刻就记上，点评读不出来、交不上时按钮也得写对
const navigationAfterReviewShown = ref(false)

async function openReview() {
  if (reviewChecking) return
  reviewChecking = true
  try {
    const res = await getReaction(problem.value!.id)
    if (res.mine === null) {
      reviewed.value = false
      commentPanel.value = true
      return
    }
  } catch {
    // 查不到就不拦：宁可少一条点评，也不能把学生卡在这道题上
  } finally {
    reviewChecking = false
  }
  settleReview()
}

/** 这次点评了结（评完了、原来就评过、或者查不到），接着去刚才被拦下的地方 */
function settleReview() {
  reviewOwed.value = false
  const target = navigationAfterReview
  navigationAfterReview = null
  navigationAfterReviewShown.value = false
  if (target) router.push(target)
}

function closeCommentPanel() {
  commentPanel.value = false
  // 「下一题」在结果页签里（LessonNext），评价完回到那里 —— 学生点评之前可能切去看了题目
  submissionStore.revealResult()
  settleReview()
}

/**
 * 评完不马上关：弹窗里换成大家怎么选的，下面只有一个按钮，焦点落在它上面。
 * 按钮去哪：刚才点「下一题」之类被拦下的，就接着去那里；否则是这节课的下一题
 * （和结果页签里 LessonNext 同一个算法）；都没有就是「好的」，关掉回到结果页签。
 */
const reviewed = ref(false)
const continueButton = useTemplateRef<{ $el: HTMLElement }>("continueButton")
const lessonStore = useLessonStore()

/** 题目名中位 7 字、最长 33 字，按钮里放不下那么长的 */
const shortTitle = (title: string) => (title.length > 14 ? `${title.slice(0, 13)}…` : title)

const continueAction = computed(() => {
  if (navigationAfterReviewShown.value) return { label: "继续", target: null }
  const lesson = problem.value ? lessonStore.nextAfter(problem.value._id) : null
  const next = ctx.value.lessonNext ? lesson?.next : null
  if (next)
    return {
      label: `下一题：${next.problemDisplayId} ${shortTitle(next.title)}`,
      target: `/problem/${next.problemDisplayId}`,
    }
  return { label: "好的", target: null }
})

async function onReviewed() {
  reviewed.value = true
  await nextTick()
  continueButton.value?.$el.focus()
}

function continueAfterReview() {
  const target = continueAction.value.target
  if (target && !navigationAfterReview) navigationAfterReview = target
  closeCommentPanel()
}

const { start: showCommentPanelDelayed, stop: cancelCommentPanel } = useTimeoutFn(
  openReview,
  1500,
  { immediate: false },
)

/**
 * 只拦「离开这道题」：换 query（左栏切页签会改 `?tab=`）不算。弹窗已经开着的时候
 * 不拦 —— 那时页面被遮罩盖住，还能走的只有浏览器后退，拦下来就等于把人关在这一页，
 * 点评接口一直失败时连退路都没有。
 */
function holdForReview(to: RouteLocationNormalized, from: RouteLocationNormalized) {
  if (!reviewOwed.value || commentPanel.value) return true
  if (to.name === from.name && to.params.problemID === from.params.problemID) return true
  navigationAfterReview = to.fullPath
  navigationAfterReviewShown.value = true
  cancelCommentPanel()
  openReview()
  return false
}

onBeforeRouteUpdate(holdForReview)
onBeforeRouteLeave(holdForReview)

const { start: goToProblemSetDelayed, stop: cancelGoToProblemSet } = useTimeoutFn(
  () => {
    router.push({
      name: "problemset",
      params: {
        problemSetId: ctx.value.problemSetId,
      },
    })
  },
  1500,
  { immediate: false },
)

/**
 * 换题时收掉通过之后那两个 1.5 秒的定时器 —— 评价弹窗是按**当前**题目去查、去弹的，
 * 不取消的话就会给一道还没做的题弹评价。欠着的点评走不到这里：离开这道题的导航
 * 已经被 holdForReview 拦下、评完才放行；还能走到这里的只有弹窗开着时按了浏览器后退。
 * 结果面板、还在跟的那条提交由 submission store 自己收。
 */
watch(
  () => problem.value?._id,
  (next, previous) => {
    if (!previous || next === previous) return
    commentPanel.value = false
    cancelCommentPanel()
    reviewOwed.value = false
    navigationAfterReview = null
    navigationAfterReviewShown.value = false
    cancelGoToProblemSet()
  },
)

// ==================== 失败计数 ====================
// 这里只数本次会话的增量，历史失败数由 problem.myFailedCount 带进来。
// 排除的状态要和后端 judge/status.ts 的 NON_FAILURE_RESULTS 对齐，
// 尤其是 system_error —— 判题机自己崩了不该推进 AI 提示的解锁进度。
watch(
  () => submission.value?.result,
  (result) => {
    if (result === undefined || result === null) return
    if (
      result === SubmissionStatus.pending ||
      result === SubmissionStatus.judging ||
      result === SubmissionStatus.submitting
    )
      return
    if (
      result !== SubmissionStatus.accepted &&
      result !== SubmissionStatus.ast_check_failed &&
      result !== SubmissionStatus.system_error
    ) {
      problemStore.incrementFailCount()
    }
  },
)

// ==================== AC庆祝效果 ====================
watch(
  () => submission.value?.result,
  (result) => {
    if (result !== SubmissionStatus.accepted && result !== SubmissionStatus.ast_check_failed) return

    // 1. 刷新题目状态
    problem.value!.myStatus = 0

    // 题单进度不在这里更新了。以前是 AC 之后回调 PUT /problem-set-progress，只认路由
    // 参数里那一个题单：从普通题库入口做出同一道题不计进度，网络一抖、页面提前关掉进度
    // 就静默丢失。现在判题那一路直接记账（judge/run.ts），而且是记进所有已加入且包含
    // 这道题的题单；收到「判完了」的时候进度已经落库，跳回题单页看到的就是新数据。

    if (result !== SubmissionStatus.accepted) return

    // 2. 放烟花
    celebrate()

    // 3. 弹出评价框。比赛里不打扰；题单里 1.5 秒后要跳回题单页，弹了也会被冲掉
    if (ctx.value.reviewAfterAccepted) {
      reviewOwed.value = true
      showCommentPanelDelayed()
    }

    if (ctx.value.backToProblemSet) {
      // 延迟回到题单页面
      goToProblemSetDelayed()
    }
  },
)

// ==================== 流程图画到 A / S ====================
// 题单里流程图作业拿到 A 或 S 就算这道题做完（后端评分那一路已经记了账），
// 和代码通过一样 1.5 秒后回题单（设计文档第 3 节决定 4、5）。只认这一页上刚评完的那一次
const flowchartStore = useFlowchartStore()
watch(
  () => flowchartStore.evaluatedSeq,
  () => {
    if (!isFlowchartPass(flowchartStore.latestRating.grade)) return
    celebrate()
    if (ctx.value.backToProblemSet) goToProblemSetDelayed()
  },
)
</script>

<template>
  <!-- 原来的标题是「恭喜你成功提交」：交上去不等于做对。auto-focus 关掉：不预选任何一项 -->
  <n-modal
    v-model:show="commentPanel"
    preset="card"
    :title="reviewed ? '大家是这样觉得的' : '做对了！说说你对这道题的感受吧'"
    :mask-closable="false"
    :closable="false"
    :close-on-esc="false"
    :auto-focus="false"
    style="width: min(600px, calc(100vw - 32px))"
  >
    <ProblemReaction guard @submitted="onReviewed">
      <template #after>
        <n-flex justify="end">
          <n-button ref="continueButton" type="primary" @click="continueAfterReview">
            {{ continueAction.label }}
          </n-button>
        </n-flex>
      </template>
    </ProblemReaction>
  </n-modal>
</template>
