<script setup lang="ts">
import { cpp } from "@codemirror/lang-cpp"
import { bracketMatching } from "@codemirror/language"
import { closeBrackets } from "@codemirror/autocomplete"
import type { EditorView } from "@codemirror/view"
import { Codemirror } from "vue-codemirror"
import { oneDark } from "../themes/oneDark"
import { smoothy } from "../themes/smoothy"
import { styleTheme } from "shared/extensions/baseTheme"
import { useCollabDoc } from "../composables/collabDoc"
import { useCollabStore } from "shared/store/collab"

const isDark = useDark()
const collabStore = useCollabStore()
const { start, stop, getInitialExtension } = useCollabDoc()

const code = ref("")
// shallowRef，理由见 SyncCodeEditor.vue：EditorView 是类实例，ref() 的深度
// UnwrapRef 会把它拆成一个丢了原型方法的假类型，vue-tsc 报莫名其妙的类型错。
const editorView = shallowRef<EditorView | null>(null)

// 教师端只在自己发起接单时开。学生端的协作在 SyncCodeEditor 里
const show = computed({
  get: () => collabStore.isTeacher && collabStore.room !== null,
  set: (value: boolean) => {
    if (!value) collabStore.leave()
  },
})

const extensions = computed(() => [
  styleTheme,
  cpp(),
  bracketMatching(),
  closeBrackets(),
  isDark.value ? oneDark : smoothy,
  getInitialExtension(),
])

const handleEditorReady = (payload: { view: EditorView }) => {
  editorView.value = payload.view
}

watch(
  () => collabStore.room,
  async (room) => {
    if (room && collabStore.isTeacher) {
      await nextTick()
      if (!editorView.value) return
      // ★ 教师端 seedContent 必须是 null —— 内容全部来自学生端
      start({ editorView: editorView.value as EditorView, seedContent: null })
    } else {
      stop()
    }
  },
)

onUnmounted(stop)
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :style="{ width: '80vw', maxWidth: '1100px' }"
    :title="`正在帮 ${collabStore.room?.peerName ?? ''} · ${collabStore.room?.problemId ?? ''}`"
  >
    <template #header-extra>
      <n-button
        text
        tag="a"
        target="_blank"
        :href="`/problem/${collabStore.room?.problemId}`"
      >
        打开题面
      </n-button>
    </template>

    <Codemirror
      v-model="code"
      indentWithTab
      :extensions="extensions"
      :tab-size="4"
      style="height: 60vh; font-size: 18px"
      @ready="handleEditorReady"
    />

    <template #footer>
      <n-flex justify="end">
        <n-button type="primary" @click="collabStore.leave()">结束协作</n-button>
      </n-flex>
    </template>
  </n-modal>
</template>
