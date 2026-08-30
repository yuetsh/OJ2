<script lang="ts" setup>
import { storeToRefs } from "pinia"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
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
const { problem } = storeToRefs(problemStore)

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

watch(
  () => codeStore.code.value,
  (v) => {
    storage.set(storageKey.value, v)
  },
)

const changeCode = (v: string) => {
  storage.set(storageKey.value, v)
}

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
    <FlowchartEditor
      v-if="codeStore.code.language === 'Flowchart'"
      ref="flowchartEditorRef"
    />
    <SyncCodeEditor
      v-else
      v-model:value="codeStore.code.value"
      :language="codeStore.code.language"
      :height="editorHeight"
      @update:model-value="changeCode"
    />
  </n-flex>
</template>
