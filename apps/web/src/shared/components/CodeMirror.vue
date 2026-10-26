<script setup lang="ts">
/**
 * CodeMirror 6 的 Vue 外壳，代码编辑器、协作编辑器、教程编辑器共用。
 *
 * 原来是 vue-codemirror，三个编辑器只用到它的 v-model、extensions、只读、缩进、
 * 占位文字、尺寸和 ready 这几样，这里照它的做法写了这几样：
 * - **basicSetup 是它默认带的**（行号、撤销、折叠、搜索、括号……），这里也带上，
 *   漏了编辑器会少一大截功能；
 * - 各项配置的先后顺序和它一致（同优先级下排前面的赢），换掉之后行为不变。
 */
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'

const {
  extensions = [],
  disabled = false,
  tabSize = 4,
  placeholder = '',
  height = '100%',
  fontSize = '',
} = defineProps<{
  /** 传稳定的数组实例：每换一个新数组，编辑器就重配一次 */
  extensions?: Extension[]
  disabled?: boolean
  tabSize?: number
  placeholder?: string
  height?: string
  fontSize?: string
}>()
const code = defineModel<string>({ default: '' })
const emit = defineEmits<{ ready: [view: EditorView] }>()

const container = useTemplateRef('container')
let view: EditorView | null = null

const compartments = {
  extensions: new Compartment(),
  disabled: new Compartment(),
  tabSize: new Compartment(),
  placeholder: new Compartment(),
  size: new Compartment(),
}

const disabledExt = (value: boolean) => (value ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : [])
const tabSizeExt = (size: number) => [EditorState.tabSize.of(size), indentUnit.of(' '.repeat(size))]
const placeholderOf = (text: string) => (text ? placeholderExt(text) : [])
const sizeExt = (h: string, fs: string) => EditorView.theme({ '&': fs ? { height: h, fontSize: fs } : { height: h } })

onMounted(() => {
  view = new EditorView({
    parent: container.value!,
    state: EditorState.create({
      doc: code.value,
      extensions: [
        basicSetup,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const doc = update.state.doc.toString()
          if (doc !== code.value) code.value = doc
        }),
        compartments.extensions.of(extensions),
        compartments.disabled.of(disabledExt(disabled)),
        keymap.of([indentWithTab]),
        compartments.tabSize.of(tabSizeExt(tabSize)),
        compartments.placeholder.of(placeholderOf(placeholder)),
        compartments.size.of(sizeExt(height, fontSize)),
      ],
    }),
  })
  emit('ready', view)
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

function reconfigure(compartment: Compartment, extension: Extension) {
  view?.dispatch({ effects: compartment.reconfigure(extension) })
}

watch(code, (value) => {
  if (!view) return
  const current = view.state.doc.toString()
  if (value === current) return
  view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
})
watch(
  () => extensions,
  (value) => reconfigure(compartments.extensions, value),
)
watch(
  () => disabled,
  (value) => reconfigure(compartments.disabled, disabledExt(value)),
)
watch(
  () => tabSize,
  (value) => reconfigure(compartments.tabSize, tabSizeExt(value)),
)
watch(
  () => placeholder,
  (value) => reconfigure(compartments.placeholder, placeholderOf(value)),
)
watch([() => height, () => fontSize], ([h, fs]) => reconfigure(compartments.size, sizeExt(h, fs)))
</script>

<template>
  <!-- display: contents，和原来 vue-codemirror 的外层一样不占布局 -->
  <div ref="container" style="display: contents" />
</template>
