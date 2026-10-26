<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { useThemeVars } from 'naive-ui'
import { richTextExtensions, toEditorHtml } from 'shared/richText'
import { uploadImage } from '../../admin/api'

interface Props {
  title: string
  simple?: boolean
  /** 一行放得下的那套：出题页左栏只有 600 宽，完整工具栏会折成三行 */
  compact?: boolean
  /** 最少的一套：出题页的输入 / 输出说明并排放，每个才 280 宽 */
  mini?: boolean
  minHeight?: number
}

const rawHtml = defineModel<string>('value')

const { title, minHeight = 0, simple = false, compact = false, mini = false } = defineProps<Props>()

const message = useMessage()
const theme = useThemeVars()

type Tool =
  | 'heading'
  | 'fontSize'
  | 'blockquote'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'color'
  | 'bgColor'
  | 'bulletList'
  | 'orderedList'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'image'
  | 'emoji'
  | 'link'
  | 'table'
  | 'codeBlock'
  | 'hr'
  | 'clear'
  | 'undo'
  | 'redo'
  | '|'

const TOOLBARS: Record<'full' | 'simple' | 'compact' | 'mini', Tool[]> = {
  full: [
    'heading',
    'fontSize',
    'blockquote',
    '|',
    'bold',
    'underline',
    'italic',
    'strike',
    'code',
    'color',
    'bgColor',
    '|',
    'bulletList',
    'orderedList',
    'alignLeft',
    'alignCenter',
    'alignRight',
    '|',
    'image',
    'emoji',
    'link',
    'table',
    'codeBlock',
    'hr',
    '|',
    'clear',
    'undo',
    'redo',
  ],
  simple: ['bold', 'color', 'bgColor', 'emoji', 'image', 'link', 'clear', 'undo', 'redo'],
  compact: ['bold', 'code', 'color', 'bgColor', '|', 'bulletList', 'orderedList', '|', 'image', 'table', 'link', 'emoji', '|', 'clear', 'undo', 'redo'],
  mini: ['bold', 'color', 'image', 'link', 'undo', 'redo'],
}

const tools = computed(() => TOOLBARS[mini ? 'mini' : simple ? 'simple' : compact ? 'compact' : 'full'])

/** 最后一次交出去的值：v-model 回来的是它就不用再 setContent，不然光标会跳到开头 */
let lastEmitted: string | undefined

const editor = useEditor({
  content: toEditorHtml(rawHtml.value ?? ''),
  extensions: richTextExtensions,
  editorProps: {
    // 截图直接粘贴、拖进来的图片文件走上传；从网页复制的带 HTML，照常粘
    handlePaste: (_view, event) => uploadFiles(event.clipboardData),
    handleDrop: (_view, event) => uploadFiles((event as DragEvent).dataTransfer),
  },
  onUpdate({ editor }) {
    // 空编辑器交空串，不交 `<p></p>`：调用方拿「空」判断必填
    lastEmitted = editor.isEmpty ? '' : editor.getHTML()
    rawHtml.value = lastEmitted
  },
})

watch(rawHtml, (value) => {
  if (!editor.value || value === lastEmitted) return
  lastEmitted = value
  editor.value.commands.setContent(toEditorHtml(value ?? ''), { emitUpdate: false })
})

/** 工具栏一律用它：保住编辑区的选区，点完按钮光标还在原处 */
function chain() {
  return editor.value!.chain().focus()
}

function isActive(name: string, attributes?: Record<string, unknown>) {
  return editor.value?.isActive(name, attributes) ?? false
}

function isAligned(align: 'left' | 'center' | 'right') {
  return editor.value?.isActive({ textAlign: align }) ?? false
}

function uploadFiles(data: DataTransfer | null | undefined) {
  if (!data || data.getData('text/html')) return false
  const images = Array.from(data.files).filter((file) => file.type.startsWith('image/'))
  if (!images.length) return false
  images.forEach(insertUploaded)
  return true
}

async function insertUploaded(file: File) {
  const path = await uploadImage(file).catch(() => '')
  if (!path) {
    message.error('图片上传失败')
    return
  }
  chain().setImage({ src: path, alt: '图片' }).run()
}

const fileInput = ref<HTMLInputElement>()

function onPickImage(event: Event) {
  const input = event.target as HTMLInputElement
  Array.from(input.files ?? []).forEach(insertUploaded)
  input.value = ''
}

const HEADINGS = [
  { label: '正文', key: 0 },
  { label: '标题 1', key: 1 },
  { label: '标题 2', key: 2 },
  { label: '标题 3', key: 3 },
]

const headingLabel = computed(() => {
  const level = [1, 2, 3].find((level) => isActive('heading', { level }))
  return level ? `标题 ${level}` : '正文'
})

function onHeading(level: number) {
  if (level === 0) chain().setParagraph().run()
  else
    chain()
      .setHeading({ level: level as 1 | 2 | 3 })
      .run()
}

const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px']
const fontSizeOptions = [{ label: '默认', key: 'default' }, ...FONT_SIZES.map((size) => ({ label: size.replace('px', ''), key: size }))]

const fontSizeLabel = computed(() => {
  const size = editor.value?.getAttributes('textStyle').fontSize as string | undefined
  return size ? size.replace('px', '') : '字号'
})

function onFontSize(size: string) {
  if (size !== 'default') chain().setFontSize(size).run()
  else chain().unsetFontSize().run()
}

// 红是 wangEditor 的那个红：库里 163 处强调都是它
const COLORS = ['#e13c39', '#e67e22', '#d4a017', '#18a058', '#2080f0', '#8e44ad', '#8a8f96', '#1f2225']
const BG_COLORS = ['#f5db4d', '#fde2e1', '#ffe8cc', '#e7f5ed', '#e6f0fd', '#f0f0f3']

const showColor = ref(false)
const showBgColor = ref(false)

const currentColor = computed(() => editor.value?.getAttributes('textStyle').color as string | undefined)

function onColor(color: string | null) {
  if (color) chain().setColor(color).run()
  else chain().unsetColor().run()
  showColor.value = false
}

function onBgColor(color: string | null) {
  if (color) chain().setBackgroundColor(color).run()
  else chain().unsetBackgroundColor().run()
  showBgColor.value = false
}

// 机房没有彩色 emoji 字体，靠站点自带的 Noto 兜底；数字键帽、↔️ 那批兜不住，别往这里加
const EMOJIS = [...'😀😄😂🤣😊😍😎🤔😅😭😡😱👍👎👏🙏💪👉👆👇✅❌❗❓💡📌📝🎯🔥⭐🎉🏆🚀💻📚⏰']
const showEmoji = ref(false)

function onEmoji(emoji: string) {
  chain().insertContent(emoji).run()
  showEmoji.value = false
}

const showLink = ref(false)
const linkUrl = ref('')

watch(showLink, (show) => {
  if (show) linkUrl.value = (editor.value?.getAttributes('link').href as string) ?? ''
})

function applyLink() {
  const url = linkUrl.value.trim()
  showLink.value = false
  if (!url) {
    chain().extendMarkRange('link').unsetLink().run()
  } else if (editor.value!.state.selection.empty && !isActive('link')) {
    // 没选字就把网址本身插进去当链接文字
    chain()
      .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
      .run()
  } else {
    chain().extendMarkRange('link').setLink({ href: url }).run()
  }
}

interface Button {
  icon: string
  label: string
  run: () => void
  active?: () => boolean
}

const BUTTONS: Partial<Record<Tool, Button>> = {
  blockquote: {
    icon: 'ph:quotes',
    label: '引用',
    run: () => chain().toggleBlockquote().run(),
    active: () => isActive('blockquote'),
  },
  bold: {
    icon: 'ph:text-b-bold',
    label: '加粗',
    run: () => chain().toggleBold().run(),
    active: () => isActive('bold'),
  },
  italic: {
    icon: 'ph:text-italic',
    label: '斜体',
    run: () => chain().toggleItalic().run(),
    active: () => isActive('italic'),
  },
  underline: {
    icon: 'ph:text-underline',
    label: '下划线',
    run: () => chain().toggleUnderline().run(),
    active: () => isActive('underline'),
  },
  strike: {
    icon: 'ph:text-strikethrough',
    label: '删除线',
    run: () => chain().toggleStrike().run(),
    active: () => isActive('strike'),
  },
  code: {
    icon: 'ph:code',
    label: '行内代码',
    run: () => chain().toggleCode().run(),
    active: () => isActive('code'),
  },
  bulletList: {
    icon: 'ph:list-bullets',
    label: '无序列表',
    run: () => chain().toggleBulletList().run(),
    active: () => isActive('bulletList'),
  },
  orderedList: {
    icon: 'ph:list-numbers',
    label: '有序列表',
    run: () => chain().toggleOrderedList().run(),
    active: () => isActive('orderedList'),
  },
  alignLeft: {
    icon: 'ph:text-align-left',
    label: '靠左',
    run: () => chain().setTextAlign('left').run(),
    active: () => isAligned('left'),
  },
  alignCenter: {
    icon: 'ph:text-align-center',
    label: '居中',
    run: () => chain().setTextAlign('center').run(),
    active: () => isAligned('center'),
  },
  alignRight: {
    icon: 'ph:text-align-right',
    label: '靠右',
    run: () => chain().setTextAlign('right').run(),
    active: () => isAligned('right'),
  },
  image: { icon: 'ph:image', label: '插入图片', run: () => fileInput.value?.click() },
  table: {
    icon: 'ph:table',
    label: '插入表格',
    run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  codeBlock: {
    icon: 'ph:code-block',
    label: '代码块',
    run: () => chain().toggleCodeBlock().run(),
    active: () => isActive('codeBlock'),
  },
  hr: { icon: 'ph:minus', label: '分割线', run: () => chain().setHorizontalRule().run() },
  clear: {
    icon: 'ph:eraser',
    label: '清除格式',
    run: () => chain().unsetAllMarks().clearNodes().run(),
  },
  undo: { icon: 'ph:arrow-counter-clockwise', label: '撤销', run: () => chain().undo().run() },
  redo: { icon: 'ph:arrow-clockwise', label: '重做', run: () => chain().redo().run() },
}

/** 光标在表格里才出来的那几个 */
const TABLE_BUTTONS: Button[] = [
  { icon: 'ph:rows-plus-bottom', label: '下面加一行', run: () => chain().addRowAfter().run() },
  {
    icon: 'ph:columns-plus-right',
    label: '右边加一列',
    run: () => chain().addColumnAfter().run(),
  },
  { icon: 'ph:rows', label: '删掉这一行', run: () => chain().deleteRow().run() },
  { icon: 'ph:columns', label: '删掉这一列', run: () => chain().deleteColumn().run() },
  { icon: 'ph:trash', label: '删掉表格', run: () => chain().deleteTable().run() },
]

const items = computed(() => tools.value.map((tool) => ({ tool, button: BUTTONS[tool] })))

const inTable = computed(() => isActive('table'))
</script>

<template>
  <div class="title" v-if="title">{{ title }}</div>
  <div class="rte">
    <div class="bar" v-if="editor">
      <template v-for="({ tool, button }, index) in items" :key="index">
        <span v-if="tool === '|'" class="sep" />

        <button v-else-if="button" type="button" class="tb" :class="{ on: button.active?.() }" :title="button.label" @mousedown.prevent @click="button.run()">
          <Icon :icon="button.icon" />
        </button>

        <n-dropdown v-else-if="tool === 'heading'" trigger="click" :options="HEADINGS" @select="onHeading">
          <button type="button" class="tb text" title="段落格式" @mousedown.prevent>{{ headingLabel }}<Icon icon="ph:caret-down" width="10" /></button>
        </n-dropdown>

        <n-dropdown v-else-if="tool === 'fontSize'" trigger="click" :options="fontSizeOptions" @select="onFontSize">
          <button type="button" class="tb text" title="字号" @mousedown.prevent>{{ fontSizeLabel }}<Icon icon="ph:caret-down" width="10" /></button>
        </n-dropdown>

        <n-popover v-else-if="tool === 'color'" v-model:show="showColor" trigger="click">
          <template #trigger>
            <button type="button" class="tb" title="文字颜色" @mousedown.prevent>
              <Icon icon="ph:text-a-underline" :style="{ color: currentColor }" />
            </button>
          </template>
          <div class="swatches">
            <button
              v-for="color in COLORS"
              :key="color"
              type="button"
              class="swatch"
              :style="{ background: color }"
              @mousedown.prevent
              @click="onColor(color)"
            />
          </div>
          <n-button size="tiny" quaternary block @mousedown.prevent @click="onColor(null)"> 去掉颜色 </n-button>
        </n-popover>

        <n-popover v-else-if="tool === 'bgColor'" v-model:show="showBgColor" trigger="click">
          <template #trigger>
            <button type="button" class="tb" title="背景色" @mousedown.prevent>
              <Icon icon="ph:highlighter" />
            </button>
          </template>
          <div class="swatches">
            <button
              v-for="color in BG_COLORS"
              :key="color"
              type="button"
              class="swatch"
              :style="{ background: color }"
              @mousedown.prevent
              @click="onBgColor(color)"
            />
          </div>
          <n-button size="tiny" quaternary block @mousedown.prevent @click="onBgColor(null)"> 去掉背景色 </n-button>
        </n-popover>

        <n-popover v-else-if="tool === 'emoji'" v-model:show="showEmoji" trigger="click">
          <template #trigger>
            <button type="button" class="tb" title="表情" @mousedown.prevent>
              <Icon icon="ph:smiley" />
            </button>
          </template>
          <div class="emojis">
            <button v-for="emoji in EMOJIS" :key="emoji" type="button" class="emoji" @mousedown.prevent @click="onEmoji(emoji)">
              {{ emoji }}
            </button>
          </div>
        </n-popover>

        <n-popover v-else-if="tool === 'link'" v-model:show="showLink" trigger="click">
          <template #trigger>
            <button type="button" class="tb" :class="{ on: isActive('link') }" title="链接" @mousedown.prevent>
              <Icon icon="ph:link" />
            </button>
          </template>
          <n-flex :size="6" :wrap="false" style="width: 280px">
            <n-input v-model:value="linkUrl" size="small" placeholder="https://" @keydown.enter.prevent="applyLink" />
            <n-button size="small" type="primary" @click="applyLink">确定</n-button>
          </n-flex>
        </n-popover>
      </template>

      <template v-if="inTable">
        <span class="sep" />
        <button v-for="button in TABLE_BUTTONS" :key="button.label" type="button" class="tb" :title="button.label" @mousedown.prevent @click="button.run()">
          <Icon :icon="button.icon" />
        </button>
      </template>
    </div>
    <EditorContent :editor="editor" class="content" :style="{ '--min-height': minHeight + 'px' }" @click.self="editor?.commands.focus('end')" />
    <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPickImage" />
  </div>
</template>

<style scoped>
.title {
  margin-bottom: 12px;
}

.rte {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 4px;
  margin-bottom: 20px;
  background: v-bind('theme.cardColor');
}

.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.tb {
  height: 24px;
  min-width: 24px;
  padding: 0 4px;
  border: 0;
  border-radius: 3px;
  background: none;
  color: v-bind('theme.textColor3');
  font: inherit;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
}

.tb svg {
  width: 16px;
  height: 16px;
}

.tb.text svg {
  width: 10px;
  height: 10px;
}

.tb:hover {
  background: v-bind('theme.hoverColor');
  color: v-bind('theme.textColor1');
}

.tb.on {
  color: v-bind('theme.primaryColor');
  background: v-bind("theme.primaryColorSuppl + '1f'");
}

.sep {
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: v-bind('theme.dividerColor');
}

.swatches {
  display: grid;
  grid-template-columns: repeat(4, 22px);
  gap: 6px;
  margin-bottom: 6px;
}

.swatch {
  width: 22px;
  height: 22px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 3px;
  cursor: pointer;
}

.emojis {
  display: grid;
  grid-template-columns: repeat(8, 28px);
  gap: 2px;
}

.emoji {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 3px;
  background: none;
  font-size: 18px;
  cursor: pointer;
}

.emoji:hover {
  background: v-bind('theme.hoverColor');
}

/* 正文样式往学生端 .oj-markdown 靠，写的时候看到的和学生看到的差不多 */
.content {
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.7;
  cursor: text;
}

.content :deep(.ProseMirror) {
  min-height: var(--min-height);
  outline: none;
  overflow-wrap: break-word;
}

.content :deep(.ProseMirror > :first-child) {
  margin-top: 0;
}

.content :deep(.ProseMirror > :last-child) {
  margin-bottom: 0;
}

.content :deep(p) {
  margin: 0.4em 0;
}

.content :deep(h1),
.content :deep(h2),
.content :deep(h3),
.content :deep(h4) {
  margin: 0.8em 0 0.4em;
  line-height: 1.4;
}

.content :deep(ul),
.content :deep(ol) {
  padding-left: 1.6em;
  margin: 0.4em 0;
}

.content :deep(li > p),
.content :deep(td > p),
.content :deep(th > p) {
  margin: 0;
}

.content :deep(a) {
  color: v-bind('theme.primaryColor');
}

/* 老题面里有写死 1118px 宽的图，别把编辑框撑出横向滚动 */
.content :deep(img) {
  max-width: 100%;
  height: auto !important;
  vertical-align: middle;
}

/* 图片外面那层可缩放的容器（richText.ts 的 StyledImage）：选中或悬停时四个角出把手 */
.content :deep([data-resize-container]) {
  max-width: 100%;
  vertical-align: middle;
}

.content :deep([data-resize-wrapper]) {
  min-width: 0;
  max-width: 100%;
}

.content :deep([data-resize-handle]) {
  display: none;
  width: 9px;
  height: 9px;
  margin: -4px;
  border: 1px solid #fff;
  background: v-bind('theme.primaryColor');
  z-index: 1;
}

.content :deep([data-resize-container]:hover [data-resize-handle]),
.content :deep(.ProseMirror-selectednode [data-resize-handle]),
.content :deep([data-resize-state='true'] [data-resize-handle]) {
  display: block;
}

.content :deep([data-resize-handle='top-left']),
.content :deep([data-resize-handle='bottom-right']) {
  cursor: nwse-resize;
}

.content :deep([data-resize-handle='top-right']),
.content :deep([data-resize-handle='bottom-left']) {
  cursor: nesw-resize;
}

.content :deep(.ProseMirror-selectednode) {
  outline: 2px solid v-bind('theme.primaryColor');
}

.content :deep(blockquote) {
  margin: 0.4em 0;
  padding-left: 10px;
  border-left: 3px solid v-bind('theme.dividerColor');
  color: v-bind('theme.textColor3');
}

.content :deep(code) {
  padding: 1px 4px;
  border-radius: 3px;
  background: v-bind('theme.codeColor');
  font-family: v-bind('theme.fontFamilyMono');
  font-size: 0.92em;
}

.content :deep(pre) {
  margin: 0.4em 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: v-bind('theme.codeColor');
  overflow-x: auto;
}

.content :deep(pre code) {
  padding: 0;
  background: none;
}

.content :deep(hr) {
  border: 0;
  border-top: 1px solid v-bind('theme.dividerColor');
  margin: 0.8em 0;
}

.content :deep(table) {
  border-collapse: collapse;
  margin: 0.4em 0;
}

.content :deep(td),
.content :deep(th) {
  min-width: 40px;
  padding: 4px 8px;
  border: 1px solid v-bind('theme.dividerColor');
  vertical-align: top;
}

.content :deep(th) {
  font-weight: 600;
  background: rgba(128, 128, 128, 0.08);
}

.content :deep(.selectedCell) {
  background: v-bind("theme.primaryColorSuppl + '1f'");
}
</style>
