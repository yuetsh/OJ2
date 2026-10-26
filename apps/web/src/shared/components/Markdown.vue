<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import { renderMarkdown } from 'shared/markdown'

/**
 * 显示一段 Markdown / HTML 正文：题面、教程、AI 的提示和报告。
 * `html` 只给老师写的内容（题面、教程）打开，AI 生成的别开 —— 理由见 shared/markdown.ts。
 * 默认 16px / 1.75，和原来 md-editor 一样；各页可以用自己的 class 盖掉。
 */
const { content, html = false } = defineProps<{
  content: string | null | undefined
  html?: boolean
}>()

const theme = useThemeVars()
const rendered = computed(() => renderMarkdown(content ?? '', html))

// 点图片看大图（原来 MdPreview 自带）。包在链接里的图片照旧走链接
const zoomed = ref('')

function onClick(e: MouseEvent) {
  const target = e.target
  if (!(target instanceof HTMLImageElement) || target.closest('a')) return
  zoomed.value = target.currentSrc || target.src
}

onKeyStroke('Escape', () => {
  zoomed.value = ''
})
</script>

<template>
  <div class="oj-markdown" v-html="rendered" @click="onClick" />
  <Teleport to="body">
    <div v-if="zoomed" class="oj-markdown-zoom" @click="zoomed = ''">
      <img :src="zoomed" alt="" />
    </div>
  </Teleport>
</template>

<!-- 不加 scoped：v-html 进来的节点不带 scoped 的属性，靠 .oj-markdown 前缀收住范围 -->
<style>
.oj-markdown {
  font-size: 16px;
  line-height: 1.75;
  /* 长英文、长网址在单词之间折；实在折不开再断词。原来 md-editor 是 break-all，
     题面里「Hello, I am …」这种一句话会从单词中间断开 */
  overflow-wrap: break-word;
}

.oj-markdown > :first-child {
  margin-top: 0;
}

.oj-markdown > :last-child {
  margin-bottom: 0;
}

.oj-markdown p {
  margin: 0.7em 0;
}

.oj-markdown h1,
.oj-markdown h2,
.oj-markdown h3,
.oj-markdown h4,
.oj-markdown h5,
.oj-markdown h6 {
  margin: 1.2em 0 0.5em;
  font-weight: 600;
  line-height: 1.4;
}

.oj-markdown h1 {
  font-size: 1.5em;
}

.oj-markdown h2 {
  font-size: 1.3em;
}

.oj-markdown h3 {
  font-size: 1.15em;
}

.oj-markdown h4,
.oj-markdown h5,
.oj-markdown h6 {
  font-size: 1em;
}

.oj-markdown ul,
.oj-markdown ol {
  margin: 0.5em 0;
  padding-left: 1.6em;
}

.oj-markdown li + li {
  margin-top: 0.25em;
}

.oj-markdown li > p {
  margin: 0.25em 0;
}

/* 后台富文本（Tiptap）存的表格，格子里的字包在 <p> 里；不收掉边距，每行都被撑高一截 */
.oj-markdown td > p,
.oj-markdown th > p {
  margin: 0;
}

.oj-markdown a {
  color: v-bind('theme.primaryColor');
  text-decoration: none;
}

.oj-markdown a:hover {
  text-decoration: underline;
}

/* 富文本存的图片带行内 style="width; height"，宽被 max-width 压窄时高还是原值，
   图片就被压扁 —— 行内样式只有 !important 盖得住 */
.oj-markdown img {
  max-width: 100%;
  height: auto !important;
  vertical-align: middle;
  cursor: zoom-in;
}

.oj-markdown a img {
  cursor: pointer;
}

.oj-markdown-zoom {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgba(0, 0, 0, 0.8);
  cursor: zoom-out;
}

.oj-markdown-zoom img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background-color: #fff;
}

.oj-markdown hr {
  margin: 1.2em 0;
  border: 0;
  border-top: 1px solid v-bind('theme.dividerColor');
}

.oj-markdown blockquote {
  margin: 0.8em 0;
  padding: 0.1em 1em;
  border-left: 4px solid v-bind('theme.dividerColor');
  color: v-bind('theme.textColor3');
}

.oj-markdown code {
  padding: 0.1em 0.45em;
  border-radius: 4px;
  background-color: rgba(128, 128, 128, 0.12);
  font-family: Consolas, Monaco, monospace;
  /* 等宽字体比同字号的中文矮，再缩就和旁边的字差一截 */
  font-size: 0.95em;
}

.oj-markdown pre {
  margin: 0.8em 0;
  padding: 12px 14px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
  overflow-x: auto;
  line-height: 1.6;
}

.oj-markdown pre code {
  padding: 0;
  border-radius: 0;
  background: none;
  font-size: 14px;
  white-space: pre;
}

/* 宽表自己横着滚，不把整页撑出横向滚动条 */
.oj-markdown table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: 0.8em 0;
  border-collapse: collapse;
}

.oj-markdown th,
.oj-markdown td {
  padding: 6px 12px;
  border: 1px solid v-bind('theme.dividerColor');
  text-align: left;
}

.oj-markdown th {
  font-weight: 600;
  background-color: rgba(128, 128, 128, 0.08);
}
</style>
