<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { useProblemStore } from "oj/store/problem"
import { useUserStore } from "shared/store/user"
import {
  DRAWER_TITLE,
  useProblemPageContext,
  type ProblemDrawer,
} from "../composables/problemPageContext"
import { useTeacherCollab } from "../composables/teacherCollab"

/**
 * 统计 / 点评 / 我的提交。原来是左栏的三个页签，课上几乎没人点，却和「题目」挤在一排；
 * 现在收进抽屉：盖住整个左栏（连上下文条、页签行），编辑器不动；抽屉顶上有自己的页签，
 * 三样之间直接切（设计稿「我的提交 / 统计 / 点评：抽屉盖住左栏」）。
 *
 * 抽屉里的内容关上就卸载：再打开时「我的提交」要重新拉，刚交的那次才看得见。
 */
const ProblemInfo = defineAsyncComponent(() => import("./ProblemInfo.vue"))
const ProblemReaction = defineAsyncComponent(() => import("./ProblemReaction.vue"))
const ProblemSubmission = defineAsyncComponent(() => import("./ProblemSubmission.vue"))

const open = defineModel<ProblemDrawer | null>({ required: true })

const props = defineProps<{
  /** 桌面：挂进左栏（它得是 position: relative）；手机：不传，从底下拉起来盖住整屏 */
  to?: HTMLElement | null
}>()

/** 抽屉顶上的页签，顺序照设计稿：最常看的「我的提交」在前 */
const tabs = computed(() =>
  (["submission", "info", "reaction"] as const).filter((key) => ctx.value.drawers.includes(key)),
)

const theme = useThemeVars()

// trap-focus 关着（编辑器还要能点），焦点不在抽屉里时 Naive 自己的 Esc 不生效，这里补一个
useEventListener(document, "keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape" && open.value) open.value = null
})

const ctx = useProblemPageContext()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
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

// 协作中的老师看的是学生的提交（ProblemSubmission 里按学生用户名查），页签写「他的提交」
const teacherCollab = useTeacherCollab()

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
  if (teacherCollab.value) {
    window.open(router.resolve(target).href, "_blank")
    return
  }
  router.push(target)
}
</script>

<template>
  <n-drawer
    v-model:show="show"
    :to="props.to ?? undefined"
    :placement="props.to ? 'left' : 'bottom'"
    :width="props.to ? '100%' : undefined"
    :height="props.to ? undefined : '85%'"
    :trap-focus="false"
    :block-scroll="!props.to"
  >
    <n-drawer-content
      :native-scrollbar="false"
      :header-style="{ padding: 0 }"
      :body-content-style="{ padding: '16px 20px' }"
    >
      <template #header>
        <div class="drawer-head">
          <div class="drawer-tabs" role="tablist">
            <button
              v-for="key in tabs"
              :key="key"
              type="button"
              role="tab"
              class="drawer-tab"
              :class="{ active: lastOpened === key }"
              :aria-selected="lastOpened === key"
              @click="open = key"
            >
              {{ key === "submission" && teacherCollab ? "他的提交" : DRAWER_TITLE[key] }}
            </button>
          </div>
          <button type="button" class="drawer-close" aria-label="关闭" @click="open = null">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </template>
      <ProblemInfo v-if="lastOpened === 'info'" />
      <ProblemReaction v-else-if="lastOpened === 'reaction'" />
      <template v-else>
        <ProblemSubmission />
        <div v-if="showAllSubmissions" class="all-submissions">
          <n-button text type="primary" @click="goAllSubmissions">看这道题所有人的提交 ›</n-button>
        </div>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.drawer-head {
  height: 48px;
  box-sizing: border-box;
  padding: 0 12px 0 20px;
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.drawer-tabs {
  display: flex;
  height: 100%;
}

.drawer-tab {
  height: 48px;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  font: inherit;
  font-size: 14px;
  font-weight: normal;
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.drawer-tab.active {
  border-bottom-color: v-bind("theme.primaryColor");
  color: v-bind("theme.textColor1");
  font-weight: 600;
}

.drawer-close {
  margin-left: auto;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: v-bind("theme.textColor2");
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.drawer-close:hover {
  background-color: v-bind("theme.hoverColor");
}

.all-submissions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  font-size: 13px;
}
</style>
