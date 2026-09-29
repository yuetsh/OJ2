<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { useDark } from "@vueuse/core"

/**
 * 只读的代码区：行号 + 高亮 + 可选地标红一行（编译失败 / 运行时错误报了行号时）。
 *
 * 不用 n-code 自带的 show-line-numbers：它没法标出某一行。行高写死成一个值，
 * 标红的那条底色按行号算 top，和代码逐行对齐。
 */
const props = withDefaults(
  defineProps<{
    code: string
    /** highlight.js 的语言名（LANGUAGE_FORMAT_VALUE） */
    language: string
    /** 要标红的行，1 起 */
    markLine?: number | null
    fontSize?: number
    lineHeight?: number
  }>(),
  { markLine: null, fontSize: 18, lineHeight: 30 },
)

const theme = useThemeVars()
const isDark = useDark()

const PADDING = 8
const lineCount = computed(() => Math.max(1, props.code.split("\n").length))
const markStyle = computed(() =>
  props.markLine && props.markLine <= lineCount.value
    ? {
        top: `${PADDING + (props.markLine - 1) * props.lineHeight}px`,
        height: `${props.lineHeight}px`,
      }
    : null,
)

const scroller = useTemplateRef<HTMLElement>("scroller")
// 换了一条就回到顶上；有标红行的，滚到那一行附近
watch(
  () => [props.code, props.markLine] as const,
  async () => {
    await nextTick()
    const el = scroller.value
    if (!el) return
    const target = props.markLine ? (props.markLine - 3) * props.lineHeight : 0
    el.scrollTop = Math.max(0, target)
    el.scrollLeft = 0
  },
  { immediate: true },
)
</script>

<template>
  <div
    ref="scroller"
    class="code-view"
    :style="{
      '--fs': `${fontSize}px`,
      '--lh': `${lineHeight}px`,
      '--pad': `${PADDING}px`,
    }"
  >
    <div class="gutter">
      <div v-for="n in lineCount" :key="n" :class="{ marked: n === markLine }">{{ n }}</div>
    </div>
    <div class="body">
      <div v-if="markStyle" class="mark" :style="markStyle"></div>
      <n-code :code="code" :language="language" />
    </div>
  </div>
</template>

<style scoped>
.code-view {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: flex-start;
  overflow: auto;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
  font-family: Consolas, Monaco, monospace;
  font-size: var(--fs);
  line-height: var(--lh);
}

.gutter {
  position: sticky;
  left: 0;
  z-index: 1;
  flex: none;
  min-width: 40px;
  min-height: 100%;
  box-sizing: border-box;
  padding: var(--pad) 10px var(--pad) 8px;
  text-align: right;
  color: v-bind("theme.textColor3");
  background: v-bind("isDark ? 'rgba(255,255,255,0.03)' : '#fafafb'");
  border-right: 1px solid v-bind("theme.dividerColor");
  user-select: none;
}

.gutter .marked {
  color: v-bind("theme.errorColor");
  font-weight: 700;
}

.body {
  position: relative;
  flex: 1 0 auto;
  padding: var(--pad) 14px;
}

.mark {
  position: absolute;
  left: 0;
  right: 0;
  background: v-bind("isDark ? 'rgba(232, 128, 128, 0.16)' : '#fdf0f2'");
}

.body :deep(.n-code) {
  position: relative;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

.body :deep(pre) {
  margin: 0;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  white-space: pre;
}
</style>
