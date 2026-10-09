<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { Tag, TagCategory } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { useTone } from "oj/submission/composables/tone"

/**
 * 题目列表左栏：知识点 / 主题，带自己的进度（设计稿「题目列表重设计 · 改版」）。
 * 只把做到了的标出来：一道没做对过的只写题数（不写 0/108），做了一部分的写 37/96 加进度条，
 * 全做对的写「通关」。老师、没登录的人 progress 是 null，只有题数。
 */
const props = defineProps<{
  tags: Tag[]
  /** 选中的标签名，空串是「全部题目」 */
  selected: string
  allCount: number
  progress: Record<string, number> | null
}>()

const emit = defineEmits<{ select: [name: string] }>()

const theme = useThemeVars()
const tone = useTone()

const mode = ref<TagCategory>("knowledge")
// 从别处带着一个主题标签进来（?tag=周杰伦），左栏得切到「主题」才看得见它
watch(
  () => [props.selected, props.tags] as const,
  ([name]) => {
    const tag = props.tags.find((t) => t.name === name)
    if (tag) mode.value = tag.category
  },
  { immediate: true },
)

// 选中的知识点在下面（「输出入门」排在第 17 个），进来时滚到看得见的地方
const navRef = ref<HTMLElement | null>(null)
watch(
  () => [props.selected, props.tags.length, mode.value],
  () =>
    nextTick(() => navRef.value?.querySelector(".item.on")?.scrollIntoView({ block: "nearest" })),
)

function byCategory(category: TagCategory) {
  return props.tags
    .filter((t) => t.category === category)
    .sort((a, b) => b.problemCount - a.problemCount)
}

const knowledge = computed(() => byCategory("knowledge"))
const themes = computed(() => byCategory("theme"))
const shown = computed(() => (mode.value === "knowledge" ? knowledge.value : themes.value))

function solvedOf(tag: Tag) {
  return props.progress?.[String(tag.id)] ?? 0
}

function percent(tag: Tag) {
  // 做对 1 道也要看得见一截，不然和没做一样
  return Math.max(3, Math.round((solvedOf(tag) / Math.max(1, tag.problemCount)) * 100))
}
</script>

<template>
  <aside class="tag-nav">
    <div class="switch">
      <button :class="{ on: mode === 'knowledge' }" @click="mode = 'knowledge'">
        知识点 {{ knowledge.length }}
      </button>
      <button :class="{ on: mode === 'theme' }" @click="mode = 'theme'">
        主题 {{ themes.length }}
      </button>
    </div>
    <nav ref="navRef" class="items">
      <button class="item flat" :class="{ on: selected === '' }" @click="emit('select', '')">
        <span class="name">全部题目</span>
        <span class="count">{{ allCount || "" }}</span>
      </button>
      <button
        v-for="tag in shown"
        :key="tag.id"
        class="item"
        :class="{ on: selected === tag.name, flat: !progress || solvedOf(tag) === 0 }"
        @click="emit('select', tag.name)"
      >
        <span class="line">
          <span class="name">{{ tag.name }}</span>
          <span v-if="!progress || solvedOf(tag) === 0" class="count">{{ tag.problemCount }}</span>
          <span v-else-if="solvedOf(tag) >= tag.problemCount" class="done">
            <Icon icon="ph:check-bold" :width="12" />通关
          </span>
          <span v-else class="count">
            <b>{{ solvedOf(tag) }}</b
            >/{{ tag.problemCount }}
          </span>
        </span>
        <span v-if="progress && solvedOf(tag) > 0" class="bar">
          <span :style="{ width: percent(tag) + '%' }"></span>
        </span>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.tag-nav {
  width: 224px;
  flex: none;
  box-sizing: border-box;
  border-right: 1px solid v-bind("theme.dividerColor");
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.switch {
  flex: none;
  padding: 14px 14px 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.switch button {
  height: 28px;
  border: 1px solid v-bind("theme.borderColor");
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  cursor: pointer;
  white-space: nowrap;
}

.switch button:first-child {
  border-radius: 3px 0 0 3px;
}

.switch button:last-child {
  margin-left: -1px;
  border-radius: 0 3px 3px 0;
}

.switch button.on {
  position: relative;
  z-index: 1;
  border-color: v-bind("theme.primaryColor");
  color: v-bind("theme.primaryColor");
}

.items {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.item {
  flex: none;
  box-sizing: border-box;
  width: 100%;
  padding: 6px 10px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  text-align: left;
  color: v-bind("theme.textColor2");
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
}

.item.flat {
  padding: 7px 10px;
  flex-direction: row;
  justify-content: space-between;
  gap: 8px;
}

.item:hover {
  background: v-bind("theme.hoverColor");
}

.item.on {
  background: v-bind("tone('success').background");
}

.item.on .name {
  font-weight: 600;
  color: v-bind("tone('success').color");
}

.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.item.flat .line {
  width: auto;
  flex: 1;
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  flex: none;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.count b {
  font-weight: 600;
  color: v-bind("tone('success').color");
}

.done {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 600;
  color: v-bind("tone('success').color");
}

.bar {
  display: block;
  height: 3px;
  border-radius: 2px;
  overflow: hidden;
  background: v-bind("theme.dividerColor");
}

.bar span {
  display: block;
  height: 3px;
  background: v-bind("theme.successColor");
}
</style>
