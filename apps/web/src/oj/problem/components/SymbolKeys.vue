<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import { useCodeStore } from 'oj/store/code'
import { editorFocused, measureKeyboard, SYMBOL_KEYS, typeSymbol, typing } from '../utils/symbolKeys'

/**
 * 手机上贴着键盘顶的一排符号键，编辑器有焦点（键盘弹着）时才出来。
 *
 * 位置按 visualViewport 算：iOS 弹键盘时布局视口不变，position: fixed; bottom: 0 的东西
 * 会被键盘盖住，只有可视视口的底边才是键盘的上沿。
 * 按下时 preventDefault：不抢编辑器的焦点，键盘不收起来。
 */
const theme = useThemeVars()
const codeStore = useCodeStore()

const keys = computed(() => {
  const language = codeStore.code.language
  if (language === 'SQL') return SYMBOL_KEYS.sql
  if (language === 'Python') return SYMBOL_KEYS.python
  if (language === 'C' || language === 'C++') return SYMBOL_KEYS.c
  return []
})

const BAR_HEIGHT = 44
const top = ref<number | null>(null)

function place() {
  const viewport = window.visualViewport
  top.value = viewport ? viewport.offsetTop + viewport.height - BAR_HEIGHT : null
}

// 键盘弹起之前就得量出「没键盘时多高」，所以挂上就量
onMounted(measureKeyboard)
useEventListener('resize', measureKeyboard)
useEventListener(
  () => window.visualViewport,
  'resize',
  () => {
    measureKeyboard()
    place()
  },
)
useEventListener(() => window.visualViewport, 'scroll', place)
watch(typing, (on) => on && place(), { immediate: true })
// 键盘弹着时点了别处换题、离开页面，编辑器直接卸载，不一定等得到失焦
onBeforeUnmount(() => {
  editorFocused.value = false
})
</script>

<template>
  <div v-if="typing && keys.length" class="symbol-keys" :style="top === null ? { bottom: '0px' } : { top: `${top}px` }" role="toolbar" aria-label="常用符号">
    <button
      v-for="key in keys"
      :key="key.label"
      type="button"
      class="key"
      :class="{ wide: key.label.length > 1 }"
      @pointerdown.prevent
      @mousedown.prevent
      @click="typeSymbol(key)"
    >
      {{ key.label }}
    </button>
  </div>
</template>

<style scoped>
.symbol-keys {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 20;
  height: 44px;
  box-sizing: border-box;
  padding: 5px 8px;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  background-color: v-bind('theme.bodyColor');
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}

.symbol-keys::-webkit-scrollbar {
  display: none;
}

.key {
  flex: none;
  min-width: 36px;
  height: 34px;
  padding: 0 6px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.06);
  font-family: Consolas, Monaco, monospace;
  font-size: 17px;
  color: inherit;
  touch-action: manipulation;
}

.key.wide {
  font-family: inherit;
  font-size: 14px;
  padding: 0 10px;
}

.key:active {
  background-color: rgba(24, 160, 88, 0.15);
}
</style>
