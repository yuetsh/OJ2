<script setup lang="ts">
import { storeToRefs } from "pinia"
import { copyToClipboard, utoa } from "utils/functions"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
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
import StatisticsPanel from "shared/components/StatisticsPanel.vue"
import { Icon } from "@iconify/vue"
import { NFlex } from "naive-ui"
import SubmitCode from "./SubmitCode.vue"

const SubmitFlowchart = defineAsyncComponent(
  () => import("./SubmitFlowchart.vue"),
)

interface Props {
  storageKey: string
}

const { storageKey } = defineProps<Props>()

const collabStore = useCollabStore()

const emit = defineEmits<{
  changeLanguage: [v: LANGUAGE]
}>()

const message = useMessage()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const codeStore = useCodeStore()
const problemStore = useProblemStore()
const { problem, languages } = storeToRefs(problemStore)

const { isDesktop } = useBreakpoints()

const statisticPanel = ref(false)

// 计算属性
const isContestMode = computed(() => route.name === "contest problem")
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
    !isContestMode.value,
)

/**
 * 状态全塞进按钮本身。原来旁边还挂一个 n-tag 说明排队情况，一行工具栏
 * （语言 / 提交 / 提交信息 / 课堂统计 / 更多操作 / 求助）在 1280 的机房屏上放不下。
 */
const helpButtonText = computed(() => {
  if (collabStore.helpStatus === "active") {
    const name = collabStore.teacherName
    return name ? `${name} 老师帮你中` : "老师正在帮你"
  }
  if (collabStore.helpStatus === "pending") {
    return collabStore.queueAhead > 0
      ? `已求助 · 前面 ${collabStore.queueAhead} 人`
      : "已求助 · 待接入"
  }
  return "求助"
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

const showGoSubmissionButton = computed(() => {
  if (isContestMode.value) return true
  else if (userStore.isAdminRole) return true
  else if (userStore.showSubmissions) return true
  else return false
})

const menuOptions = computed<DropdownOption[]>(() => {
  const options: DropdownOption[] = []
  // 移动端额外收纳桌面端常驻的两项
  if (!isDesktop.value) {
    if (showGoSubmissionButton.value) {
      options.push({
        label: "提交信息",
        key: "submissions",
      })
    }
    if (userStore.isTeacherOrAbove) {
      options.push({
        label: "课堂统计",
        key: "statistics",
      })
    }
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
    options.push({
      label: "重置代码",
      key: "reset",
    })
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
    case "submissions":
      goSubmissions()
      break
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

const languageOptions: DropdownOption[] = languages.value.map((it) => ({
  label: () =>
    h(NFlex, { align: "center" }, () => [
      h(Icon, {
        icon: ICON_SET[it],
        width: 16,
      }),
      LANGUAGE_SHOW_VALUE[it],
    ]),
  value: it,
}))

const copy = async () => {
  const success = await copyToClipboard(codeStore.code.value)
  message[success ? "success" : "error"](`代码复制${success ? "成功" : "失败"}`)
}

const reset = () => {
  codeStore.setCode(
    problem.value!.template[codeStore.code.language] ||
      SOURCES[codeStore.code.language],
  )
  storage.remove(storageKey)
  message.success("代码重置成功")
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
    input: problemStore.problem?.samples[0].input,
  }
  const base64 = utoa(JSON.stringify(data))
  const url = `${import.meta.env.PUBLIC_CODE_URL}?share=${encodeURIComponent(base64)}`
  window.open(url, "_blank")
}

const goSubmissions = () => {
  const name = route.params.contestID ? "contest submissions" : "submissions"
  router.push({ name, query: { problem: problem.value!._id } })
}

const goEdit = () => {
  const url = problem.value!.contestId
    ? `/admin/contest/${problem.value!.contestId}/problem/edit/${problem.value!.id}`
    : `/admin/problem/edit/${problem.value!.id}`
  window.open(router.resolve(url).href, "_blank")
}

onMounted(() => {
  if (!languages.value.includes(codeStore.code.language)) {
    // 回退到题目支持的第一种语言（如 SQL 题只有 "SQL"，硬编码 Python3 会被后端拒绝）
    codeStore.code.language = languages.value[0] ?? "Python3"
  }
})
</script>

<template>
  <n-flex align="center">
    <n-select
      v-model:value="codeStore.code.language"
      style="width: 120px"
      :size="buttonSize"
      :options="languageOptions"
      @update:value="changeLanguage"
    />

    <SubmitFlowchart v-if="codeStore.code.language === 'Flowchart'" />

    <SubmitCode v-else />

    <n-button
      v-if="isDesktop && showGoSubmissionButton"
      :size="buttonSize"
      @click="goSubmissions"
    >
      提交信息
    </n-button>

    <n-button
      v-if="isDesktop && userStore.isTeacherOrAbove"
      :size="buttonSize"
      @click="statisticPanel = true"
    >
      课堂统计
    </n-button>

    <!-- 自测猫 / 复制代码 / 重置代码 / 编辑题目 收进下拉菜单；移动端再加上提交信息 / 课堂统计 -->
    <n-dropdown
      v-if="menuOptions.length"
      trigger="click"
      :options="menuOptions"
      @select="handleMenuSelect"
    >
      <n-button :size="buttonSize">更多操作</n-button>
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
