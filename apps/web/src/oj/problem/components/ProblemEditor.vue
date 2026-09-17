<script lang="ts" setup>
import { storeToRefs } from "pinia"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
import { SOURCES } from "utils/constants"
import SyncCodeEditor from "shared/components/SyncCodeEditor.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import storage from "utils/storage"
import type { LANGUAGE } from "utils/types"
import Form from "./Form.vue"

const FlowchartEditor = defineAsyncComponent(
  () => import("shared/components/FlowchartEditor/index.vue"),
)

const route = useRoute()
const flowchartEditorRef = useTemplateRef("flowchartEditorRef")

const codeStore = useCodeStore()
const problemStore = useProblemStore()
const collabStore = useCollabStore()
const { problem } = storeToRefs(problemStore)

/**
 * 课堂求助的协作就开在这道题上。
 *
 * 教师端原来是一个独立的弹框（CollabModal，里面第二个 CodeMirror），现在接单
 * 直接跳到题目页、就在页面这一个编辑器里协作 —— 顺带治好了「按一下 Esc 弹框就关、
 * 协作跟着结束」：页面上没有弹框可关，结束协作只有工具栏那个按钮和离开这一页两条路。
 */
const collabHere = computed(
  () =>
    collabStore.room !== null &&
    collabStore.room.problemId === problem.value?._id,
)

/** 协作中的教师：编辑器里是学生的代码，不是他自己的 */
const teacherCollab = computed(() => collabHere.value && collabStore.isTeacher)

/** 教师接单前自己选的语言，协作结束后连同草稿一起还原 */
let teacherLanguageBefore: LANGUAGE | null = null

/**
 * 协作中**教师的语言选择跟着学生走**（选择器同时禁用，见 Form.vue），学生中途切了
 * 还会再同步一次。
 *
 * 写的是 codeStore 而不是只改编辑器的高亮：提交、语法检查、去自测猫读的都是
 * `codeStore.code.language` —— 只改高亮的话，老师会拿着自己那档语言提交学生的代码
 * （学生写 C、老师选的是 Python，当场 CE），工具栏还可能显示「提交流程图」。
 *
 * 直接写 store 不会连带重载模板代码：那是 Form 里选择器的 `update:value` 才做的事。
 *
 * **学生端一个字都不动**（早退出），他的语言本来就是权威那一份 —— 服务端的
 * `room_language` 只发给教师，学生本地那份 `room.language` 停在建房那一刻，
 * 拿它当依据的话学生一切语言就卡在旧的那套上。
 *
 * `immediate` 是必须的：老师从别的题跳过来时，房间早就开着了，非立即的 watch
 * 在挂载这一轮压根不会触发。
 */
watch(
  () => [collabHere.value, collabStore.room?.language] as const,
  ([here, language], previous) => {
    if (!collabStore.isTeacher) return
    const wasHere = previous?.[0] ?? false
    if (here && language) {
      if (!wasHere) teacherLanguageBefore = codeStore.code.language
      if (codeStore.code.language !== language)
        codeStore.code.language = language
      return
    }
    if (!here && wasHere) {
      if (teacherLanguageBefore) codeStore.code.language = teacherLanguageBefore
      teacherLanguageBefore = null
      // 草稿也读回来。上面那道 persistCode 的闸保证了 storage 里还是老师自己的代码
      loadCode()
    }
  },
  { immediate: true },
)

const { isDesktop } = useBreakpoints()

const contestID = route.params.contestID || null
const storageKey = computed(
  () =>
    `problem_${problem.value!._id}_contest_${contestID}_lang_${codeStore.code.language}`,
)

const editorHeight = computed(() =>
  isDesktop.value ? "calc(100vh - 133px)" : "calc(100vh - 172px)",
)

function loadCode() {
  const savedCode = storage.get(storageKey.value)
  codeStore.setCode(
    savedCode ||
      problem.value!.template[codeStore.code.language] ||
      SOURCES[codeStore.code.language],
  )
}

onMounted(loadCode)

watch(() => problem.value?._id, loadCode)

/**
 * 存本地草稿。**协作中的教师不存** —— 那会儿编辑器里是学生的代码，存下去就把
 * 老师自己在这道题上的草稿盖掉了（他可能正开着自己的解法）。学生照存，那是他本人的。
 */
const persistCode = (v: string) => {
  if (teacherCollab.value) return
  storage.set(storageKey.value, v)
}

watch(() => codeStore.code.value, persistCode)

const changeCode = persistCode

const changeLanguage = (v: LANGUAGE) => {
  const savedCode = storage.get(storageKey.value)
  codeStore.setCode(
    savedCode && storageKey.value.split("_").pop() === v
      ? savedCode
      : problem.value!.template[codeStore.code.language] ||
          SOURCES[codeStore.code.language],
  )
}

// 提供FlowchartEditor的ref给子组件
provide("flowchartEditorRef", flowchartEditorRef)
</script>

<template>
  <n-flex vertical>
    <Form :storage-key="storageKey" @change-language="changeLanguage" />
    <!--
      协作中教师这边不会落到流程图分支：上面那个 watch 已经把他的语言换成了学生的，
      而求助入口本身就排掉了流程图（Form.vue 的 showHelpButton、服务端的
      COLLAB_LANGUAGES），所以 room.language 不可能是 Flowchart。
      学生自己切到流程图就是不写代码了，编辑器卸载、协作正常结束（SyncCodeEditor
      的 detach），这是原来就有的语义。
    -->
    <FlowchartEditor
      v-if="codeStore.code.language === 'Flowchart'"
      ref="flowchartEditorRef"
    />
    <SyncCodeEditor
      v-else
      v-model:value="codeStore.code.value"
      :language="codeStore.code.language"
      :problem-id="problem!._id"
      :height="editorHeight"
      @update:model-value="changeCode"
    />
  </n-flex>
</template>
