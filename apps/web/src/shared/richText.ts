import { Extension, getRenderedAttributes, ResizableNodeView } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { StarterKit } from '@tiptap/starter-kit'

/**
 * 后台富文本（题面、提示、公告、比赛说明）的 Tiptap 配置。
 *
 * 库里存的是 wangEditor 时代写下的 HTML，Tiptap 只认 schema 里有的东西，认不出的
 * 打开再保存就**悄悄没了**。换编辑器前拿全量 3384 条做过往返比对（HTML → Tiptap → HTML，
 * 再过一遍 markdown-it 比学生看到的），下面两个补丁就是比出来的：不补的话 232 条的
 * 图片尺寸、28 条的缩进会丢。base64 内嵌图片（12 条）靠 `allowBase64`。
 * 改这里的扩展之前，照那次的办法重新比一遍。
 */

/** 图片的宽高大多写在 style 里（`width: 384px; height: 435px`，也有百分比），原样留着 */
const StyledImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element) => element.getAttribute('style'),
        renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
      },
    }
  },

  // 拖四个角缩放。Tiptap 自带的 resize 把尺寸写进 width / height 属性，可老图的尺寸在 style 里、
  // 盖过属性，拖完存下来还是原来的大小 —— 所以自己接：宽写回 style，高去掉（学生端高一律 auto）
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const img = document.createElement('img')
      const extensionAttributes = editor.extensionManager.attributes

      /** 节点属性原样落到 <img> 上，编辑区和存下来的 HTML 是同一个样子 */
      const render = (node: Parameters<typeof getRenderedAttributes>[0]) => {
        const attributes = getRenderedAttributes(node, extensionAttributes)
        for (const name of img.getAttributeNames()) {
          if (attributes[name] == null) img.removeAttribute(name)
        }
        for (const [name, value] of Object.entries(attributes)) {
          if (value != null) img.setAttribute(name, value)
        }
        // 拖动的是外面那层容器，图片自己不能被浏览器当成原生拖拽
        img.draggable = false
      }

      render(node)
      const view = new ResizableNodeView({
        element: img,
        editor,
        node,
        getPos,
        onCommit: (width) => {
          const pos = getPos()
          if (pos === undefined) return
          const { style } = document.createElement('img')
          style.cssText = view.node.attrs.style ?? ''
          style.removeProperty('height')
          style.width = `${Math.round(width)}px`
          editor.chain().setNodeSelection(pos).updateAttributes(this.name, { style: style.cssText, width: null, height: null }).run()
        },
        onUpdate: (node) => {
          render(node)
          return true
        },
        options: {
          directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
          min: { width: 24, height: 24 },
          preserveAspectRatio: true,
        },
      })
      // 它会拿 width 属性往 style 里写一份，和 style 里原有的宽打架；以节点属性为准
      render(node)
      return view
    }
  },
})

/** 段落的首行缩进、左边距。老题面里有 `text-indent: 28pt`、`padding-left: 40px` 这种 */
const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return (['text-indent', 'padding-left', 'margin-left'] as const).map((property) => ({
      types: ['paragraph', 'heading'],
      attributes: {
        [property]: {
          default: null,
          parseHTML: (element: HTMLElement) => element.style.getPropertyValue(property) || null,
          renderHTML: (attributes: Record<string, string | null>) => (attributes[property] ? { style: `${property}: ${attributes[property]}` } : {}),
        },
      },
    }))
  },
})

export const richTextExtensions = [
  StarterKit.configure({ link: { openOnClick: false } }),
  TextStyleKit,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TableKit,
  StyledImage.configure({ inline: true, allowBase64: true }),
  Indent,
]

/**
 * 交给编辑器之前的整理。没有标签的纯文本（库里 125 条）原样喂进去，换行会被当成空白
 * 吞掉 —— 学生端是 markdown-it（breaks: true）渲染的，原来那些换行是真的会换行
 */
export function toEditorHtml(value: string) {
  if (value.includes('<')) return value
  return value.replace(/&/g, '&amp;').replace(/\n/g, '<br>')
}
