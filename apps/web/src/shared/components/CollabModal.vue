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

const bind = (view: EditorView) => {
  if (!collabStore.isTeacher || !collabStore.room) return
  // ★ 教师端 seedContent 必须是 null —— 内容全部来自学生端
  start({ editorView: view, seedContent: null })
}

/**
 * 起点是「编辑器就绪」，不是「房间打开」。
 *
 * n-modal 默认 display-directive="if"，每次打开都会重挂一个全新的 CodeMirror。
 * 原来在 watch 里 `await nextTick()` 之后去取 editorView：赶上 teleport + 离场
 * 过渡没走完，取到的是上一轮那个已经 destroy 的 view，start() 静默绑到死编辑器上，
 * 老师对着空白框干等，服务端那边房间却是活的。
 */
const handleEditorReady = (payload: { view: EditorView }) => {
  editorView.value = payload.view
  bind(payload.view)
}

watch(
  () => collabStore.room,
  (room) => {
    // 常规路径下开房时编辑器还没挂，这里是 null，由 @ready 接手；
    // 万一哪天 display-directive 改成 show（编辑器常驻），这条分支才起作用
    if (room && collabStore.isTeacher) {
      if (editorView.value) bind(editorView.value)
    } else {
      stop()
      // 编辑器随模态框一起卸载了，留着这个引用下轮就会绑到一个死 view 上
      editorView.value = null
    }
  },
)

onUnmounted(() => {
  stop()
  editorView.value = null
})
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

    <!--
      不绑 v-model：这个编辑器的内容完全由 Yjs 文档接管。
      原来绑了一个跨会话不清的 code ref —— 模态框重挂时 CodeMirror 拿它当初始
      文档，而 yCollab 只观察 ytext、从不反过来用 ytext 覆盖编辑器，于是上一个
      学生的代码留在文档里，新学生的内容作为 delta 插到位置 0，两边的偏移从此
      对不上，教师和学生显示的是两份不同的文档。
    -->
    <Codemirror
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
