<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import type { RouteLocationRaw } from "vue-router"

/**
 * 上下文条里的一排题号（课堂、比赛共用）。只放题号，题目名在鼠标停上去时给。
 *
 * 状态用图标区分，不只靠颜色：✓ 做完（实心绿）/ ! 做过没对（橙）/ 灰底 没做；当前题描边。
 * 一节课一般 5 道以内，一行放得下；多了（比赛、老师一次布置了一长串）就横向滚动，
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
}>()

const theme = useThemeVars()

const STATUS_TEXT = { done: "做完了", tried: "做过，还没对", none: "还没做" } as const

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
  <div ref="scroller" class="chips">
    <n-tooltip v-for="item in items" :key="item.displayId" :delay="300">
      <template #trigger>
        <router-link
          :to="item.to"
          class="chip"
          :class="[item.status, { current: isCurrent(item) }]"
          :aria-label="`${item.displayId} ${item.title}（${STATUS_TEXT[item.status]}）`"
          :aria-current="isCurrent(item) ? 'page' : undefined"
        >
          <!-- 用字符不用图标：图标是从 Iconify 源现拉的，拉不到时状态就只剩颜色 -->
          <span v-if="item.status === 'done'" aria-hidden="true">✓</span>
          <span v-else-if="item.status === 'tried'" aria-hidden="true">!</span>
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
  scrollbar-width: thin;
  /* 描边的外圈别被裁掉 */
  padding: 3px 2px;
}

.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  padding: 0 9px;
  border-radius: 13px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-decoration: none;
  color: v-bind("theme.textColor2");
  background-color: rgba(128, 128, 128, 0.12);
  border: 1px solid transparent;
}

.chip.done {
  color: #fff;
  background-color: v-bind("theme.successColor");
}

.chip.tried {
  color: v-bind("theme.warningColor");
  background-color: rgba(240, 160, 32, 0.12);
  border-color: rgba(240, 160, 32, 0.5);
}

.chip.current {
  border-color: v-bind("theme.primaryColor");
  box-shadow: 0 0 0 1px v-bind("theme.primaryColor");
  font-weight: 600;
}

/* 当前题做完了：实心绿，外面再套一圈（中间隔一道底色） */
.chip.done.current {
  border-color: v-bind("theme.successColor");
  box-shadow:
    0 0 0 2px v-bind("theme.bodyColor"),
    0 0 0 3px v-bind("theme.successColor");
}

.chip:hover {
  filter: brightness(0.95);
}
</style>
