<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import type { RouteLocationRaw } from "vue-router"

/**
 * 上下文条里的一排题号（课堂、比赛共用）。只放题号，题目名在鼠标停上去时给。
 *
 * 状态用图标区分，不只靠颜色：✓ 做完（实心绿）/ 做过没对（课堂是橙色 !，比赛是红色 ✕）/
 * 灰底 没做；当前题描边，做完了的当前题实心绿再套一圈。课堂是圆角胶囊、比赛是方角
 * （设计稿「上下文条与协作状态」）。一节课一般 5 道以内，一行放得下；多了就横向滚动，
 * 当前题保持在视野里。
 */
export interface ChipItem {
  displayId: string
  title: string
  status: "done" | "tried" | "none"
  to: RouteLocationRaw
}

const props = defineProps<{
  items: ChipItem[]
  current: string
  variant: "lesson" | "contest"
}>()

const theme = useThemeVars()
/** 「做完」的实心绿上用什么字色：暗色主题的成功色是浅薄荷绿，白字几乎看不见 */
const isDark = useDark()
const doneText = computed(() => (isDark.value ? "rgba(0, 0, 0, 0.85)" : "#fff"))

const STATUS_TEXT = computed(
  () =>
    ({
      done: "做完了",
      tried: props.variant === "contest" ? "交过，还没对" : "做过，还没对",
      none: "还没做",
    }) as const,
)

const isCurrent = (item: ChipItem) => item.displayId.toLowerCase() === props.current.toLowerCase()

const scroller = useTemplateRef<HTMLElement>("scroller")

// 换题之后把当前那一颗滚进来。`nearest`：本来就看得见就不动，免得一换题整排跳一下
watch(
  () => [props.current, props.items.length],
  async () => {
    await nextTick()
    scroller.value
      ?.querySelector<HTMLElement>(".chip.current")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
  },
  { immediate: true },
)
</script>

<template>
  <!-- 类名带前缀：父组件（ContextBar）的 .lesson / .contest 会作用到子组件根元素上 -->
  <div ref="scroller" class="chips" :class="`chips-${variant}`">
    <n-tooltip v-for="item in items" :key="item.displayId" :delay="300">
      <template #trigger>
        <router-link
          :to="item.to"
          class="chip"
          :class="[item.status, { current: isCurrent(item) }]"
          :aria-label="`${item.displayId} ${item.title}（${STATUS_TEXT[item.status]}）`"
          :aria-current="isCurrent(item) ? 'page' : undefined"
        >
          <!-- 内嵌 SVG，不走 Iconify：图标源拉不到时状态就只剩颜色了 -->
          <svg
            v-if="item.status === 'done'"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12l5 5 9-10" />
          </svg>
          <svg
            v-else-if="item.status === 'tried' && variant === 'contest'"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
          <svg
            v-else-if="item.status === 'tried'"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M12 7v6" />
            <path d="M12 17h.01" />
          </svg>
          <span>{{ item.displayId }}</span>
        </router-link>
      </template>
      {{ item.displayId }} {{ item.title }} · {{ STATUS_TEXT[item.status] }}
    </n-tooltip>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  /* 当前题外面那一圈别被裁掉 */
  padding: 4px 3px;
}

.chips::-webkit-scrollbar {
  display: none;
}

.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  box-sizing: border-box;
  padding: 0 8px;
  border-radius: 13px;
  border: 1.5px solid transparent;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-decoration: none;
  color: v-bind("theme.textColor2");
  background-color: rgba(128, 128, 128, 0.14);
}

.chips-contest .chip {
  border-radius: 4px;
}

.chip.done {
  color: v-bind(doneText);
  background-color: v-bind("theme.successColor");
}

.chip.tried {
  color: v-bind("theme.warningColorPressed");
  background-color: rgba(240, 160, 32, 0.12);
  border: 1px solid rgba(240, 160, 32, 0.45);
}

.chips-contest .chip.tried {
  color: v-bind("theme.errorColorPressed");
  background-color: rgba(208, 48, 80, 0.12);
  border-color: transparent;
}

.chip.current:not(.done) {
  color: v-bind("theme.primaryColorPressed");
  background-color: v-bind("theme.cardColor");
  border: 1.5px solid v-bind("theme.primaryColor");
  font-weight: 700;
}

.chips-contest .chip.current:not(.done) {
  color: v-bind("theme.warningColorPressed");
  border-color: v-bind("theme.warningColor");
}

/* 当前题做完了：实心绿，外面再套一圈（中间隔一道底色） */
.chip.done.current {
  font-weight: 700;
  border-color: v-bind("theme.primaryColorPressed");
  box-shadow:
    0 0 0 2px v-bind("theme.cardColor"),
    0 0 0 3.5px v-bind("theme.primaryColorPressed");
}

.chip:hover {
  filter: brightness(0.95);
}
</style>
