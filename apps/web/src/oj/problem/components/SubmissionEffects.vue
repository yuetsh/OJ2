<script setup lang="ts">
import { storeToRefs } from "pinia"
import type { RouteLocationNormalized } from "vue-router"
import { getReaction } from "oj/api"
import { useProblemStore } from "oj/store/problem"
import { useSubmissionStore } from "oj/store/submission"
import { useFireworks } from "oj/problem/composables/useFireworks"
import { useBreakpoints } from "shared/composables/breakpoints"
import { SubmissionStatus } from "utils/constants"

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

const route = useRoute()
const router = useRouter()
// 题目页在题库 / 比赛 / 题单三条路由之间是复用的，所以跟着路由算，不在 setup 时取一次
const contestID = computed(() => (route.params.contestID as string) ?? "")
const problemSetId = computed(() => (route.params.problemSetId as string) ?? "")

const { isDesktop } = useBreakpoints()
const { celebrate } = useFireworks()

// ==================== AC 后弹出点评轮盘 ====================
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

async function openReview() {
  if (reviewChecking) return
  reviewChecking = true
  try {
    const res = await getReaction(problem.value!.id)
    if (res.mine === null) {
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
  if (target) router.push(target)
}

function closeCommentPanel() {
  commentPanel.value = false
  // 「下一题」在结果页签里（LessonNext），评价完回到那里 —— 学生点评之前可能切去看了题目
  submissionStore.revealResult()
  settleReview()
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
        problemSetId: problemSetId.value,
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
    if (!contestID.value && !problemSetId.value) {
      reviewOwed.value = true
      showCommentPanelDelayed()
    }

    if (problemSetId.value) {
      // 延迟回到题单页面
      goToProblemSetDelayed()
    }
  },
)
</script>

<template>
  <n-modal
    preset="card"
    title="恭喜你成功提交，说说你对这道题的感受吧"
    :mask-closable="false"
    :closable="false"
    :close-on-esc="false"
    :style="{ maxWidth: isDesktop && '50vw', maxHeight: '80vh' }"
    v-model:show="commentPanel"
  >
    <ProblemReaction @submitted="closeCommentPanel" />
  </n-modal>
</template>
