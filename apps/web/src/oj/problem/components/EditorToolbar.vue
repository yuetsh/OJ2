<script setup lang="ts">
import { storeToRefs } from "pinia"
import { copyToClipboard, compressToBase64 } from "utils/functions"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
import { useSubmissionStore } from "oj/store/submission"
import {
  ICON_SET,
  LANGUAGE_FORMAT_VALUE,
  LANGUAGE_SHOW_VALUE,
  SOURCES,
  STORAGE_KEY,
} from "utils/constants"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import storage from "utils/storage"
import type { LANGUAGE } from "utils/types"
import { Icon } from "@iconify/vue"
import { NFlex } from "naive-ui"
import SubmitCode from "./SubmitCode.vue"
import { useProblemPageContext } from "../composables/problemPageContext"

const SubmitFlowchart = defineAsyncComponent(() => import("./SubmitFlowchart.vue"))
// 只有老师看得见（下面的弹框挂了 isTeacherOrAbove），静态 import 的话每个学生
// 打开题目都要白拉一份 chart.js（~68KB gzip）
const StatisticsPanel = defineAsyncComponent(() => import("shared/components/StatisticsPanel.vue"))

interface Props {
  storageKey: string
}

const { storageKey } = defineProps<Props>()

const collabStore = useCollabStore()

const emit = defineEmits<{
  changeLanguage: [v: LANGUAGE]
}>()

const message = useMessage()
const router = useRouter()
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
const mode = computed({
  get: () => (drawing.value ? "draw" : "code"),
  set: (value: "draw" | "code") => {
    if (value === "draw") problemStore.switchLanguage("Flowchart")
    else problemStore.switchLanguage(problemStore.supportedLanguage(codeStore.preferredLanguage()))
  },
})

const { isDesktop } = useBreakpoints()

const statisticPanel = ref(false)

/**
 * 「运行例子」：用题目里的例子试跑（Judge0），结果在左栏「结果」页签。顶替原来题面里
 * 每个例子旁的「测试」按钮 —— 那个在左栏、离编辑器远，只给通过 / 不通过、2 秒后复位。
 * Judge0 跑不了 SQL，流程图也没得跑；没有例子的题不给。
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
 * 教师端：协作就开在这道题上。接单后直接跳到题目页协作（原来是 CollabModal 弹框），
 * 所以状态和「结束协作」得摆在题目页的工具栏上 —— 也只有这一个按钮能结束，
 * 不像弹框那样按一下 Esc 就把协作关掉了。
 */
const collabHere = computed(
  () => collabStore.room !== null && collabStore.room.problemId === problem.value?._id,
)
const showCollabBar = computed(() => collabHere.value && userStore.isTeacherOrAbove)

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
const toolbarRef = useTemplateRef<{ $el: HTMLElement }>("toolbarRef")
const { width: toolbarWidth } = useElementSize(() => toolbarRef.value?.$el)
const narrow = computed(() => isDesktop.value && toolbarWidth.value > 0 && toolbarWidth.value < 600)
/** 「课堂统计」常驻在工具栏上：桌面、而且放得下 */
const statisticsInline = computed(() => isDesktop.value && !narrow.value)

const menuOptions = computed<DropdownOption[]>(() => {
  const options: DropdownOption[] = []
  // 放不下时（手机、右栏太窄）收进来的「课堂统计」。「本题提交」挪到了「我的提交」抽屉的底部
  if (!statisticsInline.value && userStore.isTeacherOrAbove) {
    options.push({
      label: "课堂统计",
      key: "statistics",
    })
  }
  if (codeStore.code.language !== "Flowchart") {
    if (codeStore.code.language !== "SQL") {
      options.push({
        label: "去自测猫",
        key: "testcat",
      })
    }
    options.push({
      label: "复制代码",
      key: "copy",
    })
    // 协作中的教师不给「重置代码」：那会儿编辑器里是**学生的**代码，而 v-model
    // 一写回去就顺着 Yjs 同步过去，等于一键清空学生的作业，他还没法撤回
    if (!showCollabBar.value) {
      options.push({
        label: "重置代码",
        key: "reset",
      })
    }
  }
  if (isDesktop.value && userStore.isSuperAdmin) {
    options.push({
      label: "编辑题目",
      key: "edit",
    })
  }
  return options
})

const handleMenuSelect = (key: string) => {
  switch (key) {
    case "statistics":
      statisticPanel.value = true
      break
    case "testcat":
      goTestCat()
      break
    case "copy":
      copy()
      break
    case "reset":
      reset()
      break
    case "edit":
      goEdit()
      break
  }
}

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

const copy = async () => {
  const success = await copyToClipboard(codeStore.code.value)
  message[success ? "success" : "error"](`代码复制${success ? "成功" : "失败"}`)
}

// 重置会把编辑器里的代码换成模板、连本地草稿一起删掉，点错一下写了半节课的代码就没了，先问一句
const dialog = useDialog()
const reset = () => {
  dialog.warning({
    title: "重置代码",
    content: "编辑器里的代码会换回题目给的模板，存着的草稿也会删掉。确定吗？",
    positiveText: "重置",
    negativeText: "再想想",
    onPositiveClick: () => {
      codeStore.setCode(
        problem.value!.template[codeStore.code.language] || SOURCES[codeStore.code.language],
      )
      storage.remove(storageKey)
      message.success("已换回模板，按 Ctrl+Z 可以撤回")
    },
  })
}

const changeLanguage = (v: LANGUAGE) => {
  storage.set(STORAGE_KEY.LANGUAGE, v)
  emit("changeLanguage", v)
}

const goTestCat = () => {
  const lang = LANGUAGE_FORMAT_VALUE[codeStore.code.language]
  const data = {
    lang,
    code: codeStore.code.value,
    // 没有例子的题原来在这里抛 TypeError，点了没反应
    input: problemStore.problem?.samples[0]?.input ?? "",
  }
  const base64 = compressToBase64(JSON.stringify(data))
  const url = `${import.meta.env.PUBLIC_CODE_URL}?share=${encodeURIComponent(base64)}`
  window.open(url, "_blank")
}

const goEdit = () => {
  const url = problem.value!.contestId
    ? `/admin/contest/${problem.value!.contestId}/problem/edit/${problem.value!.id}`
    : `/admin/problem/edit/${problem.value!.id}`
  window.open(router.resolve(url).href, "_blank")
}

// 语言回退不在这里做：它得排在载入草稿之前，见 problem store 的 supportedLanguage
</script>

<template>
  <n-flex ref="toolbarRef" align="center" :size="narrow ? 8 : 12">
    <!-- 协作中的老师不会落到画图：求助入口本身就排掉了流程图 -->
    <n-radio-group v-if="canDraw && !showCollabBar" v-model:value="mode" :size="buttonSize">
      <n-radio-button value="code">{{ narrow ? "代码" : "写代码" }}</n-radio-button>
      <n-radio-button value="draw">{{ narrow ? "流程图" : "画流程图" }}</n-radio-button>
    </n-radio-group>

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
      :loading="samplesRunning"
      :disabled="!codeStore.code.value.trim()"
      @click="submissionStore.runSamples()"
    >
      运行例子
    </n-button>

    <SubmitFlowchart v-if="codeStore.code.language === 'Flowchart'" />

    <SubmitCode v-else-if="isDesktop" />

    <n-button
      v-if="statisticsInline && userStore.isTeacherOrAbove"
      :size="buttonSize"
      @click="statisticPanel = true"
    >
      课堂统计
    </n-button>

    <!-- 自测猫 / 复制代码 / 重置代码 / 编辑题目 收进下拉菜单；放不下时再加上课堂统计 -->
    <n-dropdown
      v-if="menuOptions.length"
      trigger="click"
      :options="menuOptions"
      @select="handleMenuSelect"
    >
      <n-button :size="buttonSize" :title="narrow ? '更多' : undefined">
        {{ narrow ? "⋯" : "更多" }}
      </n-button>
    </n-dropdown>

    <n-button
      v-if="showHelpButton"
      :size="buttonSize"
      :type="helpButtonType"
      :disabled="collabStore.helpStatus === 'active'"
      :title="helpButtonTitle"
      @click="toggleHelp"
    >
      {{ helpButtonText }}
    </n-button>
  </n-flex>

  <n-modal
    v-if="userStore.isTeacherOrAbove"
    v-model:show="statisticPanel"
    preset="card"
    title="提交记录的统计"
    :style="{ maxWidth: isDesktop && '800px', maxHeight: '80vh' }"
    :content-style="{ overflow: 'auto' }"
  >
    <StatisticsPanel :problem="problem!._id" username="" />
  </n-modal>
</template>
