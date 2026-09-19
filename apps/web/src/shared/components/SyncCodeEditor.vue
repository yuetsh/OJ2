<script lang="ts" setup>
import { bracketMatching } from "@codemirror/language"
import { Codemirror } from "vue-codemirror"
import {
  autocompletion,
  closeBrackets,
  completeAnyWord,
} from "@codemirror/autocomplete"
import type { EditorView } from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import type { LANGUAGE } from "utils/types"
import { oneDark } from "../themes/oneDark"
import { smoothy } from "../themes/smoothy"
import { styleTheme } from "shared/extensions/baseTheme"
import { enhanceCompletion } from "shared/extensions/autocompletion"
import { languageExtension } from "shared/extensions/language"
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
  /** 追加的 CodeMirror 扩展。传一个稳定的数组实例，每次渲染新建会让编辑器反复重配 */
  extraExtensions?: Extension[]
  /**
   * 当前这个编辑器属于哪道题（题目的展示 ID）。
   *
   * **协作只在题号对得上时才建立。** 教师端现在也在题目页里协作（原来是单独的
   * CollabModal 弹框），他接单时人可能停在别的题上 —— 不比对题号的话那个编辑器
   * 会绑上学生的文档，老师看着自己的题面改着别人的代码。学生那边同理：排队期间
   * 切到别的题，接通了也不该把这道题的代码交出去。
   */
  problemId?: string
}

const {
  language = "Python3",
  fontSize = 20,
  height = "100%",
  readonly = false,
  placeholder = "",
  extraExtensions = [],
  problemId = "",
} = defineProps<Props>()
const code = defineModel<string>("value")

const langExtension = computed(() => languageExtension(language))

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
  ...extraExtensions,
])

interface EditorReadyPayload {
  view: EditorView
}

// shallowRef，不是 ref：CodeMirror 的 EditorView 是带 getter 的类实例，
// Vue 的 UnwrapRef 深度展开会把它结构化成一个丢了原型方法的假类型，
// vue-tsc 会报 "missing dispatchTransactions/_root/..." 这类莫名其妙的错。
// 项目里旧的 sync.ts 用的是裸变量，同一个道理，这里换成 shallowRef 规避。
const editorView = shallowRef<EditorView | null>(null)

/** 房间开着，而且开的就是这道题 */
const roomIsHere = computed(
  () =>
    collabStore.room !== null &&
    (!problemId || collabStore.room.problemId === problemId),
)

/**
 * 这个编辑器**接进过**当前这个房间。
 *
 * 用来区分两件看起来一样的事：「房间从我这儿挪走了」（我得明确结束协作）和
 * 「房间在别处开起来了」（跟我无关，不能替别人把协作掐掉）。老师在别的题上
 * 接单时后者天天发生 —— room 先 open、再导航过来，那一瞬间旧页面的编辑器
 * 看到的就是「房间非空但不是我这道题」。
 */
const bound = ref(false)

const bind = (view: EditorView) => {
  if (!roomIsHere.value) return
  bound.value = true
  // ★ 内容源只有学生一个：学生端拿自己的编辑器内容当种子，教师端必须传 null，
  //   理由见 collabDoc.ts 的 StartOptions
  start({
    editorView: view,
    seedContent: collabStore.isTeacher ? null : view.state.doc.toString(),
  })
}

/**
 * 拆掉本地绑定。**房间还在、只是不在这道题上了**（人走了，不是协作结束了）时
 * 补一条 leave：
 *
 * - 教师从学生这道题切去别的题 —— 不发的话学生那边一直挂着「老师正在帮你」，
 *   而老师的编辑器早就不在这个房间里，字一个也过不去；
 * - 学生在协作中切去别的题 —— 同理。
 *
 * `/problem/1001` → `/problem/1003` 是同一条路由换 params，**组件被复用、不卸载**，
 * 所以这件事不能只靠 onUnmounted（实测就是这么漏的）。
 */
const detach = () => {
  const wasBound = bound.value
  bound.value = false
  stop()
  if (wasBound && collabStore.room) collabStore.leave("left")
}

const handleEditorReady = (payload: EditorReadyPayload) => {
  editorView.value = payload.view
  // 也从这里起：学生排队时切去看提交记录、老师在这期间接了单，
  // 等他切回来时 room 早就非空了，只靠下面的 watch 是等不到的
  bind(payload.view)
}

/**
 * 房间开了才建文档。学生点求助时什么都不做 —— 老师没来之前不该动他的编辑器。
 *
 * **现在两边都走这里。** 教师端原来是一个独立的 CollabModal（弹框里再挂一个
 * CodeMirror），接单改成跳到题目页之后，两边协作的都是页面上这一个编辑器，
 * setBinaryHandler 那个单例槽位也只剩一个使用者，不会再有两个编辑器谁后调用
 * 谁把对方顶掉的问题。
 *
 * 所以收窄的条件从「不是教师」换成了「房间开的是这道题」（roomIsHere）——
 * 教师停在别的题上时照样不绑。
 */
watch(
  // 两个源都要盯：
  //
  // - `room` 这个对象本身（换人、结束都会整个替换它）—— 同一道题上老师刚结束
  //   一个学生又接下一个时，roomIsHere 全程为真，只看它就不会重建文档，
  //   老师会留在上一轮那份已经没人的 Y.Doc 上；
  // - `roomIsHere` —— 老师接单时人在**另一道题**的页面上，跳过来是
  //   `/problem/1002` → `/problem/1001`，同一条路由只换 params，**组件被复用**，
  //   `@ready` 不会再触发一次，而 room 早在导航之前就 open 了。只盯 room 的话
  //   老师会停在一个空编辑器上干等（实测就是这样）。
  //
  // 协作期间学生切语言是就地改 room.language、不替换对象，所以不会误重连。
  [() => collabStore.room, roomIsHere],
  () => {
    if (roomIsHere.value) {
      if (editorView.value) bind(editorView.value)
    } else detach()
  },
)

// 求助期间切了语言：同步给老师，他那边的高亮和补全跟着换。
// 教师端不发 —— 协作中教师这个编辑器的语言本来就是跟着学生走的
// （ProblemEditor 的 editorLanguage），反过来发一遍只会把学生的语言覆盖掉
watch(
  () => language,
  (lang) => {
    if (!collabStore.isTeacher) collabStore.updateLanguage(lang)
  },
)

/**
 * 学生**排队期间离开了这道题**：撤掉求助。
 *
 * 那条求助说的是「我卡在这道题」，人不在这道题上了就不成立了 —— 原来它会一直挂在
 * 队列里，老师接进来时学生的编辑器不在这道题上、根本不会绑，老师对着一个空编辑器
 * 敲字，两边都没有提示。把语言切成流程图同理：那一档连求助按钮都没有，留着他自己
 * 也取消不掉。
 *
 * **只认「离开」这件事，不跟房间状态挂钩**：老师走开时服务端会把求助退回排队，
 * 那条刚补上的 pending 不能被这里顺手取消掉。
 */
const cancelPendingIfLeaving = () => {
  if (collabStore.isTeacher) return
  if (collabStore.helpStatus === "pending") collabStore.cancelHelp()
}

// 同一条路由换 params（切到别的题）组件会被复用，所以这件事不能只靠 onUnmounted
watch(
  () => problemId,
  (next, previous) => {
    if (previous && next !== previous) cancelPendingIfLeaving()
  },
)

onUnmounted(() => {
  cancelPendingIfLeaving()
  // 卸载意味着编辑器没了（切走整个页面、或者把语言切成流程图），CRDT 会话没法
  // 接着用：回来时只能新建 Y.Doc，再拿编辑器内容当种子就会和对方那份合并成重复
  // 文本。所以不是「悄悄把绑定拆了」，而是走 detach 明确结束协作 ——
  // 教师端同理，他现在是在题目页里协作，离开这一页就是这次帮忙结束了。
  detach()
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
