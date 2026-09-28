<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
import { useUserStore } from "shared/store/user"
import {
  DRAWER_TITLE,
  useProblemPageContext,
  type ProblemDrawer,
} from "../composables/problemPageContext"

/**
 * 统计 / 点评 / 我的提交。原来是左栏的三个页签，课上几乎没人点，却和「题目」挤在一排；
 * 现在收进抽屉，盖住左栏、编辑器不动。
 *
 * 抽屉里的内容关上就卸载：再打开时「我的提交」要重新拉，刚交的那次才看得见。
 */
const ProblemInfo = defineAsyncComponent(() => import("./ProblemInfo.vue"))
const ProblemReaction = defineAsyncComponent(() => import("./ProblemReaction.vue"))
const ProblemSubmission = defineAsyncComponent(() => import("./ProblemSubmission.vue"))

const open = defineModel<ProblemDrawer | null>({ required: true })

const props = defineProps<{
  /** 桌面：挂进左栏（它得是 position: relative）；手机：不传，从底下拉起来盖住整屏 */
  to?: string
}>()

const ctx = useProblemPageContext()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const collabStore = useCollabStore()
const { problem } = storeToRefs(useProblemStore())

const show = computed({
  get: () => open.value !== null,
  set: (value) => {
    if (!value) open.value = null
  },
})

// 内容和标题都按最后一次打开的来：关的时候有一段滑出去的动画，那时 open 已经是 null 了。
// 关完 n-drawer 自己把内容卸掉
const lastOpened = ref<ProblemDrawer>("info")
watch(open, (key) => {
  if (key) lastOpened.value = key
})

// 换题就关：抽屉里是上一道题的统计和提交
watch(
  () => problem.value?._id,
  () => {
    open.value = null
  },
)

/**
 * 「看这道题所有人的提交」，原来是工具栏上的「本题提交」。可见条件照旧：
 * 比赛里总给（看的是这场比赛的提交），题库里要管理员或者开着提交列表。
 */
const showAllSubmissions = computed(
  () => ctx.value.entry === "contest" || userStore.isAdminRole || userStore.showSubmissions,
)

function goAllSubmissions() {
  const target = {
    name: ctx.value.entry === "contest" ? "contest submissions" : "submissions",
    params: ctx.value.entry === "contest" ? { contestID: route.params.contestID } : {},
    query: { problem: problem.value!._id },
  }
  // 协作中走新标签：教师端「页面即协作现场」，跳走这一页协作就结束了
  // （求助会退回排队，但老师还得再接一次）。而「看看这学生都交了什么」恰好是
  // 协作时最常点的一个
  const collabHere =
    collabStore.room !== null &&
    collabStore.room.problemId === problem.value?._id &&
    userStore.isTeacherOrAbove
  if (collabHere) {
    window.open(router.resolve(target).href, "_blank")
    return
  }
  router.push(target)
}
</script>

<template>
  <n-drawer
    v-model:show="show"
    :to="props.to"
    :placement="props.to ? 'left' : 'bottom'"
    :width="props.to ? '100%' : undefined"
    :height="props.to ? undefined : '85%'"
    :trap-focus="false"
    :block-scroll="!props.to"
  >
    <n-drawer-content :title="DRAWER_TITLE[lastOpened]" closable :native-scrollbar="false">
      <ProblemInfo v-if="lastOpened === 'info'" />
      <ProblemReaction v-else-if="lastOpened === 'reaction'" />
      <template v-else>
        <ProblemSubmission />
        <n-button
          v-if="showAllSubmissions"
          class="all-submissions"
          text
          type="primary"
          @click="goAllSubmissions"
        >
          看这道题所有人的提交 ›
        </n-button>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.all-submissions {
  margin-top: 12px;
}
</style>
