<script setup lang="ts">
import { markdown } from "@codemirror/lang-markdown"
import { EditorSelection } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { Icon } from "@iconify/vue"
import CodeMirror from "./CodeMirror.vue"
import { uploadImage } from "../../admin/api"
import { styleTheme } from "../extensions/baseTheme"
import { darkCodeTheme, lightCodeTheme } from "../themes/codeTheme"

/**
 * 后台教程正文的 Markdown 编辑器：左边写，右边由教程编辑页用学生端同一套组件预览。
 * 原来是 md-editor-v3，但它每次打开都去 unpkg.com 拉 highlight.js、katex、mermaid、echarts，
 * 而这里只需要一个能插格式、能传图的文本框，所以换成项目里已有的 CodeMirror。
 * 图片三种进法：工具栏按钮选文件、粘贴、拖进来，都是先传到服务器再插 ![](地址)。
 */
const { height, codeLang = "python" } = defineProps<{
  height?: string
  /** 「代码块」按钮插入的语言：教程里标了 python / c 的代码块在学生端是能运行的 */
  codeLang?: string
}>()

const modelValue = defineModel<string>("value")

const isDark = useDark()
const message = useMessage()
const view = shallowRef<EditorView>()

/** 选中了就把选中的包起来，没选中就插一段占位文字并选中它，方便直接改 */
function wrap(before: string, after: string, placeholder: string) {
  const v = view.value
  if (!v) return
  v.dispatch(
    v.state.changeByRange((range) => {
      const text = range.empty ? placeholder : v.state.sliceDoc(range.from, range.to)
      return {
        changes: { from: range.from, to: range.to, insert: before + text + after },
        range: EditorSelection.range(
          range.from + before.length,
          range.from + before.length + text.length,
        ),
      }
    }),
  )
  v.focus()
}

/** 给选中的每一行（没选中就是光标那行）行首加前缀：标题、列表、引用 */
function prefixLines(prefix: (index: number) => string) {
  const v = view.value
  if (!v) return
  const { from, to } = v.state.selection.main
  const first = v.state.doc.lineAt(from).number
  const last = v.state.doc.lineAt(to).number
  const changes = []
  for (let n = first; n <= last; n++) {
    changes.push({ from: v.state.doc.line(n).from, insert: prefix(n - first) })
  }
  v.dispatch({ changes })
  v.focus()
}

/**
 * 在光标处插一段自成一行的内容；`cursor` 是插完后光标落在这段文字里的位置（默认放末尾）
 */
function insertBlock(text: string, cursor = text.length) {
  const v = view.value
  if (!v) return
  const { from, to } = v.state.selection.main
  const line = v.state.doc.lineAt(from)
  const lead = from === line.from ? "" : "\n"
  const insert = `${lead}${text}\n`
  v.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + lead.length + cursor },
  })
  v.focus()
}

/** 教程编辑页插练一练占位符用 */
function insert(text: string) {
  insertBlock(text)
}

defineExpose({ insert })

const uploading = ref(false)
const fileInput = useTemplateRef<HTMLInputElement>("fileInput")

async function uploadAndInsert(files: File[]) {
  const images = files.filter((file) => file.type.startsWith("image/"))
  if (!images.length) return
  uploading.value = true
  try {
    const paths = await Promise.all(images.map((file) => uploadImage(file).catch(() => "")))
    if (paths.some((path) => !path)) message.error("有图片没传上去")
    const ok = paths.filter(Boolean)
    if (ok.length) insertBlock(ok.map((path) => `![](${path})`).join("\n"))
  } finally {
    uploading.value = false
  }
}

function onPickImages(e: Event) {
  const input = e.target as HTMLInputElement
  void uploadAndInsert([...(input.files ?? [])])
  input.value = ""
}

const imageEvents = EditorView.domEventHandlers({
  paste(event) {
    const files = [...(event.clipboardData?.files ?? [])]
    if (!files.some((file) => file.type.startsWith("image/"))) return false
    event.preventDefault()
    void uploadAndInsert(files)
    return true
  },
  drop(event, v) {
    const files = [...(event.dataTransfer?.files ?? [])]
    if (!files.some((file) => file.type.startsWith("image/"))) return false
    event.preventDefault()
    // 插到松手的位置
    const pos = v.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos !== null) v.dispatch({ selection: { anchor: pos } })
    void uploadAndInsert(files)
    return true
  },
})

const shortcuts = keymap.of([
  { key: "Mod-b", run: () => (wrap("**", "**", "加粗文字"), true) },
  { key: "Mod-i", run: () => (wrap("*", "*", "斜体文字"), true) },
])

/** styleTheme 只写了 Monaco，机房的 Windows 没有它；和 Markdown.vue 里代码的字体保持一致 */
const fontTheme = EditorView.theme({
  "& .cm-scroller": { fontFamily: "Consolas, Monaco, monospace" },
})

const extensions = computed(() => [
  styleTheme,
  fontTheme,
  markdown(),
  EditorView.lineWrapping,
  imageEvents,
  shortcuts,
  isDark.value ? darkCodeTheme : lightCodeTheme,
])

const tools = computed(() => [
  { icon: "ph:text-h-two-bold", title: "标题", run: () => prefixLines(() => "## ") },
  { icon: "ph:text-b-bold", title: "加粗（Ctrl+B）", run: () => wrap("**", "**", "加粗文字") },
  { icon: "ph:code-bold", title: "行内代码", run: () => wrap("`", "`", "代码") },
  {
    icon: "ph:code-block-bold",
    title: `代码块（${codeLang}，学生那边能运行）`,
    run: () => insertBlock(`\`\`\`${codeLang}\n\n\`\`\``, codeLang.length + 4),
  },
  { icon: "ph:list-bullets-bold", title: "无序列表", run: () => prefixLines(() => "- ") },
  { icon: "ph:list-numbers-bold", title: "有序列表", run: () => prefixLines((i) => `${i + 1}. `) },
  { icon: "ph:quotes-bold", title: "引用", run: () => prefixLines(() => "> ") },
  {
    icon: "ph:table-bold",
    title: "表格",
    run: () => insertBlock("| 列 1 | 列 2 |\n| --- | --- |\n|  |  |"),
  },
  { icon: "ph:link-bold", title: "链接", run: () => wrap("[", "](https://)", "链接文字") },
])
</script>

<template>
  <div class="editor-box" :style="height ? { height } : undefined">
    <div class="toolbar">
      <button
        v-for="tool in tools"
        :key="tool.icon"
        type="button"
        class="tool"
        :title="tool.title"
        :aria-label="tool.title"
        @click="tool.run"
      >
        <Icon :icon="tool.icon" :width="16" />
      </button>
      <button
        type="button"
        class="tool"
        title="图片（也可以直接粘贴、拖进来）"
        aria-label="插入图片"
        :disabled="uploading"
        @click="fileInput?.click()"
      >
        <Icon icon="ph:image-bold" :width="16" />
      </button>
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPickImages" />
    </div>
    <div class="body">
      <CodeMirror
        v-model="modelValue"
        :extensions="extensions"
        :tab-size="4"
        font-size="14px"
        @ready="view = $event"
      />
    </div>
  </div>
</template>

<style scoped>
.editor-box {
  display: flex;
  flex-direction: column;
  min-height: 300px;
}

.toolbar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.22);
}

.tool {
  width: 30px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.tool:hover:not(:disabled) {
  background-color: rgba(128, 128, 128, 0.14);
}

.tool:disabled {
  cursor: wait;
  opacity: 0.6;
}

.body {
  flex: 1;
  min-height: 0;
}
</style>
