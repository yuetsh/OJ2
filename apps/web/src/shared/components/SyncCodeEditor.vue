<script lang="ts" setup>
import { cpp } from "@codemirror/lang-cpp"
import { python } from "@codemirror/lang-python"
import { sql, SQLite } from "@codemirror/lang-sql"
import { bracketMatching } from "@codemirror/language"
import { Codemirror } from "vue-codemirror"
import {
  autocompletion,
  closeBrackets,
  completeAnyWord,
} from "@codemirror/autocomplete"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LANGUAGE } from "utils/types"
import { oneDark } from "../themes/oneDark"
import { smoothy } from "../themes/smoothy"
import { styleTheme } from "shared/extensions/baseTheme"
import { enhanceCompletion } from "shared/extensions/autocompletion"
import { useCollabDoc } from "../composables/collabDoc"
import { useCollabStore } from "shared/store/collab"

const isDark = useDark()
const collabStore = useCollabStore()
const { start, stop, getInitialExtension } = useCollabDoc()

interface Props {
  language?: LANGUAGE
  fontSize?: number
  height?: string
  readonly?: boolean
  placeholder?: string
}

const {
  language = "Python3",
  fontSize = 20,
  height = "100%",
  readonly = false,
  placeholder = "",
} = defineProps<Props>()
const code = defineModel<string>("value")

const langExtension = computed((): Extension => {
  if (language === "SQL")
    return sql({ dialect: SQLite, upperCaseKeywords: true })
  return ["Python2", "Python3"].includes(language) ? python() : cpp()
})

const extensions = computed(() => [
  styleTheme,
  langExtension.value,
  bracketMatching(),
  closeBrackets(),
  isDark.value ? oneDark : smoothy,
  autocompletion({
    override: [enhanceCompletion(language), completeAnyWord],
  }),
  getInitialExtension(),
])

interface EditorReadyPayload {
  view: EditorView
}

// shallowRef，不是 ref：CodeMirror 的 EditorView 是带 getter 的类实例，
// Vue 的 UnwrapRef 深度展开会把它结构化成一个丢了原型方法的假类型，
// vue-tsc 会报 "missing dispatchTransactions/_root/..." 这类莫名其妙的错。
// 项目里旧的 sync.ts 用的是裸变量，同一个道理，这里换成 shallowRef 规避。
const editorView = shallowRef<EditorView | null>(null)

const bind = (view: EditorView) => {
  if (collabStore.isTeacher || !collabStore.room) return
  // 学生端：当前编辑器内容就是内容源
  start({ editorView: view, seedContent: view.state.doc.toString() })
}

const handleEditorReady = (payload: EditorReadyPayload) => {
  editorView.value = payload.view
  // 也从这里起：学生排队时切去看提交记录、老师在这期间接了单，
  // 等他切回来时 room 早就非空了，只靠下面的 watch 是等不到的
  bind(payload.view)
}

// 房间开了才建文档。学生点求助时什么都不做 —— 老师没来之前不该动他的编辑器。
// 只在学生端启用：这个组件挂在每个用户的题目页上（教师也不例外，
// ProblemEditor.vue 只按语言是不是 Flowchart 分支，不看角色），
// 教师接单同样会让 collabStore.room 非空 —— 如果这里不按角色收窄，
// 教师自己停在某道题的页面上接单时，这个组件会把**教师自己的编辑器内容**
// 当成种子插入文档，还会跟 CollabModal 抢 setBinaryHandler 这个单例槽位，
// 两者谁后调用谁把对方顶掉。教师端的协作只归 CollabModal 管。
watch(
  () => collabStore.room,
  (room) => {
    if (room && !collabStore.isTeacher && editorView.value) bind(editorView.value)
    else stop()
  },
)

onUnmounted(() => {
  stop()
  // 这个组件卸载意味着编辑器没了（切走页面、或者把语言切成流程图），
  // CRDT 会话没法接着用：回来时只能新建 Y.Doc，再拿编辑器内容当种子就会和
  // 老师那份合并成重复文本。所以不是"悄悄把绑定拆了"，而是明确结束协作 ——
  // 否则老师那边模态框照开、字照敲，一个也到不了学生那里
  if (collabStore.room && !collabStore.isTeacher) collabStore.leave()
})
</script>

<template>
  <Codemirror
    v-model="code"
    indentWithTab
    :extensions="extensions"
    :disabled="readonly"
    :tab-size="4"
    :placeholder="placeholder"
    :style="{ height, fontSize: `${fontSize}px` }"
    @ready="handleEditorReady"
  />
</template>
