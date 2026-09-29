<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
import { useSubmissionStore } from "oj/store/submission"
import { ICON_SET, LANGUAGE_SHOW_VALUE, STORAGE_KEY } from "utils/constants"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import storage from "utils/storage"
import type { LANGUAGE } from "utils/types"
import { Icon } from "@iconify/vue"
import { NFlex, useThemeVars } from "naive-ui"
import SubmitCode from "./SubmitCode.vue"
import { useProblemPageContext } from "../composables/problemPageContext"
import { openStatistics, useEditorMenu } from "../composables/editorMenu"
import { useTeacherCollab } from "../composables/teacherCollab"

const SubmitFlowchart = defineAsyncComponent(() => import("./SubmitFlowchart.vue"))

const collabStore = useCollabStore()

const emit = defineEmits<{
  changeLanguage: [v: LANGUAGE]
}>()

const ctx = useProblemPageContext()
const userStore = useUserStore()
const codeStore = useCodeStore()
const problemStore = useProblemStore()
const { problem, codeLanguages, canDraw } = storeToRefs(problemStore)

/**
 * 「写代码 / 画流程图」是两种作业，不是两门语言。原来流程图藏在语言下拉里，叫一个名叫
 * Flowchart 的「语言」—— 有的题流程图交了几百次、代码个位数，入口却在下拉的第一项里。
 */
const drawing = computed(() => codeStore.code.language === "Flowchart")
const MODES = [
  { value: "code", label: "写代码", short: "代码" },
  { value: "draw", label: "画流程图", short: "流程图" },
] as const
const mode = computed({
  get: () => (drawing.value ? "draw" : "code"),
  set: (value: "draw" | "code") => {
    if (value === "draw") problemStore.switchLanguage("Flowchart")
    else problemStore.switchLanguage(problemStore.supportedLanguage(codeStore.preferredLanguage()))
  },
})

const { isDesktop } = useBreakpoints()
const theme = useThemeVars()

/**
 * 「运行例子」：用题目里的例子试跑（本站判题机），结果在左栏「结果」页签。顶替原来题面里
 * 每个例子旁的「测试」按钮 —— 那个在左栏、离编辑器远，只给通过 / 不通过、2 秒后复位。
 * SQL 不走判题机，流程图也没得跑；没有例子的题不给。
 */
const submissionStore = useSubmissionStore()
const { samplesRunning } = submissionStore.trial
const canRunSamples = computed(
  () =>
    !!problem.value?.samples.length &&
    codeStore.code.language !== "Flowchart" &&
    codeStore.code.language !== "SQL",
)

const buttonSize = computed(() => (isDesktop.value ? "medium" : "small"))
// 可见条件沿用原来的 showSyncFeature，再加上「不是教师」——
// 教师端的入口在顶栏，不在题目页
const showHelpButton = computed(
  () =>
    isDesktop.value &&
    userStore.isAuthed &&
    !userStore.isTeacherOrAbove &&
    // 演示模式下协作通道是断开的（见 App.vue），按钮点了也没人收
    !userStore.demoMode &&
    codeStore.code.language !== "Flowchart" &&
    ctx.value.help,
)

/**
 * 教师正在这道题上协作：编辑器里是学生的代码。协作状态和「结束协作」在工具栏上面那条
 * 协作条里（CollabBar）；工具栏这边禁掉语言选择、不给「写代码 / 画流程图」切换
 */
const showCollabBar = useTeacherCollab()

/**
 * 状态全塞进按钮本身。原来旁边还挂一个 n-tag 说明排队情况，一行工具栏
 * （语言 / 提交 / 本题提交 / 课堂统计 / 更多 / 求助）在 1280 的机房屏上放不下。
 */
const helpButtonText = computed(() => {
  if (collabStore.helpStatus === "active") {
    const name = collabStore.teacherName
    return name ? `${name} 老师在帮你` : "老师正在帮你"
  }
  if (collabStore.helpStatus === "pending") {
    return collabStore.queueAhead > 0
      ? `已举手 · 前面 ${collabStore.queueAhead} 人`
      : "已举手 · 老师马上来"
  }
  return "举手求助"
})

const helpButtonType = computed(() => {
  if (collabStore.helpStatus === "active") return "success"
  if (collabStore.helpStatus === "pending") return "warning"
  return "default"
})

// 排队中点一下就是取消，这句话再挤进 label 就太长了，挂在原生 title 上。
// active 时按钮是 disabled，浏览器不会给 disabled 元素显示 title，所以不放
const helpButtonTitle = computed(() =>
  collabStore.helpStatus === "pending" ? "点击取消求助" : undefined,
)

const toggleHelp = () => {
  if (collabStore.helpStatus === "pending") collabStore.cancelHelp()
  else if (collabStore.helpStatus === "idle")
    collabStore.requestHelp(problem.value!._id, codeStore.code.language)
}

/**
 * 右栏窄于 600px（学生把左栏拖宽看长题面、宽 SQL 表时）：工具栏折成两行会把编辑器往下挤，
 * 所以次要的按钮收进「更多」、「写代码 / 画流程图」缩短一点（设计文档 5.4）。语言下拉不收：
 * 窄于 120px 时图标和「Python」会被挤成两行
 */
const toolbarRef = useTemplateRef<HTMLElement>("toolbarRef")
const { width: toolbarWidth } = useElementSize(toolbarRef)
const narrow = computed(() => isDesktop.value && toolbarWidth.value > 0 && toolbarWidth.value < 600)
/** 「课堂统计」常驻在工具栏上：桌面、而且放得下 */
const statisticsInline = computed(() => isDesktop.value && !narrow.value)

// 去自测猫 / 复制 / 重置 / 编辑题目。手机上整张菜单在页签行的「⋯」里，工具栏不放
const { options: menuOptions, select: handleMenuSelect } = useEditorMenu(statisticsInline)

// computed：换题时组件复用，选项得跟着新题的语言走
const languageOptions = computed<DropdownOption[]>(() =>
  codeLanguages.value.map((it) => ({
    label: () =>
      h(NFlex, { align: "center" }, () => [
        h(Icon, {
          icon: ICON_SET[it],
          width: 16,
        }),
        LANGUAGE_SHOW_VALUE[it],
      ]),
    value: it,
  })),
)

const changeLanguage = (v: LANGUAGE) => {
  storage.set(STORAGE_KEY.LANGUAGE, v)
  emit("changeLanguage", v)
}

// 语言回退不在这里做：它得排在载入草稿之前，见 problem store 的 supportedLanguage
</script>

<template>
  <!-- 设计稿：语言、运行例子、提交靠左；求助、课堂统计、⋯ 推到最右 -->
  <div ref="toolbarRef" class="toolbar" :class="{ narrow }">
    <!-- 协作中的老师不会落到画图：求助入口本身就排掉了流程图 -->
    <!-- 设计稿：灰底分段，选中的白底加粗 -->
    <div
      v-if="canDraw && !showCollabBar"
      class="mode"
      role="tablist"
      aria-label="写代码 / 画流程图"
    >
      <button
        v-for="item in MODES"
        :key="item.value"
        type="button"
        role="tab"
        class="mode-item"
        :class="{ active: mode === item.value }"
        :aria-selected="mode === item.value"
        @click="mode = item.value"
      >
        {{ narrow ? item.short : item.label }}
      </button>
    </div>

    <!-- 协作中编辑器的语言跟着学生走，这个选择器改了也不会生效，索性禁掉 -->
    <n-select
      v-if="!drawing"
      v-model:value="codeStore.code.language"
      style="width: 120px"
      :size="buttonSize"
      :options="languageOptions"
      :disabled="showCollabBar"
      @update:value="changeLanguage"
    />

    <!-- 手机上「运行例子」「提交」在屏幕底部那条（MobileActionBar），三个页签都在 -->
    <n-button
      v-if="canRunSamples && isDesktop"
      :size="buttonSize"
      type="primary"
      ghost
      :loading="samplesRunning"
      :disabled="!codeStore.code.value.trim()"
      @click="submissionStore.runSamples()"
    >
      运行例子
    </n-button>

    <SubmitFlowchart v-if="codeStore.code.language === 'Flowchart'" />

    <SubmitCode v-else-if="isDesktop" />

    <div class="spacer" />

    <n-button
      v-if="showHelpButton"
      :size="buttonSize"
      :type="helpButtonType"
      :secondary="collabStore.helpStatus !== 'idle'"
      :disabled="collabStore.helpStatus === 'active'"
      :title="helpButtonTitle"
      class="help"
      @click="toggleHelp"
    >
      <span v-if="collabStore.helpStatus === 'active'" class="dot" aria-hidden="true" />
      {{ helpButtonText }}
    </n-button>

    <n-button
      v-if="ctx.classStats && statisticsInline && userStore.isTeacherOrAbove"
      :size="buttonSize"
      @click="openStatistics(problem!._id)"
    >
      课堂统计
    </n-button>

    <!-- 自测猫 / 复制代码 / 重置代码 / 编辑题目 收进下拉菜单；放不下时再加上课堂统计 -->
    <n-dropdown
      v-if="isDesktop && menuOptions.length"
      trigger="click"
      :options="menuOptions"
      @select="handleMenuSelect"
    >
      <n-button :size="buttonSize" class="more" aria-label="更多：去自测猫、复制代码、重置代码……">
        ⋯
      </n-button>
    </n-dropdown>
  </div>
</template>

<style scoped>
.toolbar {
  height: 48px;
  flex: none;
  box-sizing: border-box;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.toolbar.narrow {
  gap: 6px;
  padding: 0 10px;
}

.spacer {
  flex: 1 1 0;
}

.mode {
  flex: none;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.12);
}

.mode-item {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font: inherit;
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.mode-item.active {
  background-color: v-bind("theme.cardColor");
  color: v-bind("theme.textColor1");
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.more {
  width: 34px;
  padding: 0;
}

.help .dot {
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
  background-color: v-bind("theme.successColor");
}
</style>
