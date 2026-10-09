<script setup lang="ts">
import type { IDomEditor, IEditorConfig, IToolbarConfig } from "@wangeditor-next/editor"
import { Editor, Toolbar } from "@wangeditor-next/editor-for-vue"
import "@wangeditor-next/editor/dist/css/style.css"
import { uploadImage } from "../../admin/api"

interface Props {
  title: string
  simple?: boolean
  /** 一行放得下的那套：出题页左栏只有 600 宽，完整工具栏会折成三行 */
  compact?: boolean
  /** 最少的一套：出题页的输入 / 输出说明并排放，每个才 280 宽 */
  mini?: boolean
  minHeight?: number
}

const rawHtml = defineModel<string>("value")
type InsertFnType = (url: string, alt: string, href: string) => void

const { title, minHeight = 0, simple = false, compact = false, mini = false } = defineProps<Props>()

const message = useMessage()

const editorRef = shallowRef<IDomEditor>()
const toolbarEditorRef = shallowRef<IDomEditor>()

const toolbarConfig: Partial<IToolbarConfig> = {
  toolbarKeys: [
    "blockquote",
    "headerSelect",
    "fontSize",
    "lineHeight",
    "|",
    "bold",
    "underline",
    "italic",
    "through",
    "color",
    "bgColor",
    "|",
    "bulletedList",
    "numberedList",
    "justifyLeft",
    "justifyCenter",
    "justifyRight",
    "|",
    "uploadImage",
    "emotion",
    "insertLink",
    "insertTable",
    "divider",
    "|",
    "clearStyle",
    "undo",
    "redo",
  ],
}

const toolbarConfigSimple: Partial<IToolbarConfig> = {
  toolbarKeys: [
    "bold",
    "color",
    "bgColor",
    "emotion",
    "uploadImage",
    "insertLink",
    "clearStyle",
    "undo",
    "redo",
  ],
}

const toolbarConfigCompact: Partial<IToolbarConfig> = {
  toolbarKeys: [
    "bold",
    "color",
    "bgColor",
    "|",
    "bulletedList",
    "numberedList",
    "|",
    "uploadImage",
    "insertTable",
    "insertLink",
    "emotion",
    "|",
    "clearStyle",
    "undo",
    "redo",
  ],
}

const toolbarConfigMini: Partial<IToolbarConfig> = {
  toolbarKeys: ["bold", "color", "uploadImage", "insertLink", "undo", "redo"],
}

const editorConfig: Partial<IEditorConfig> = {
  scroll: false,
  MENU_CONF: {
    // @ts-ignore
    uploadImage: { customUpload },
  },
}

onBeforeUnmount(() => {
  const editor = editorRef.value
  if (editor) editor.destroy()
})

function onClick() {
  if (!editorRef.value) return
  editorRef.value.blur()
  editorRef.value.focus()
}

async function handleCreated(editor: IDomEditor) {
  editorRef.value = editor
  await nextTick()
  toolbarEditorRef.value = editor
}

async function customUpload(file: File, insertFn: InsertFnType) {
  const path = await uploadImage(file)
  if (!path) {
    message.error("图片上传失败")
    return
  }
  const url = path
  const alt = "图片"
  const href = ""
  insertFn(url, alt, href)
}
</script>

<template>
  <div class="title" v-if="title">{{ title }}</div>
  <div class="editorWrapper">
    <Toolbar
      class="toolbar"
      :editor="toolbarEditorRef"
      :defaultConfig="
        mini
          ? toolbarConfigMini
          : simple
            ? toolbarConfigSimple
            : compact
              ? toolbarConfigCompact
              : toolbarConfig
      "
      mode="simple"
    />
    <Editor
      @click="onClick"
      :style="{ minHeight: minHeight + 'px' }"
      v-model="rawHtml"
      :defaultConfig="editorConfig"
      mode="simple"
      @onCreated="handleCreated"
    />
  </div>
</template>

<style scoped>
.title {
  margin-bottom: 12px;
}

.toolbar {
  border-bottom: 1px solid #ddd;
}

.editorWrapper {
  border: 1px solid #ddd;
  margin-bottom: 20px;
}
</style>
