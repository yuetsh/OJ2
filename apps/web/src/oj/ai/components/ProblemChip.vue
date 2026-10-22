<script setup lang="ts">
import type { LearningItem } from "@oj2/contract"
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { statusName } from "../utils"

/**
 * 一道题一块：绿勾一次就对、黄色交几次才对、红色没做对、虚线没交。
 * 指上去看细节（班上第几个做对、最后一次错在哪），点进去学生是做题、老师是看提交。
 */
const props = defineProps<{
  item: LearningItem
  /** 课上的题才说「班上第几个做对」；自己练的题同学大多没做，排第几没意义 */
  inLesson: boolean
  /** 老师在看这个学生：不称呼（分不出男女），点进去看这个学生的提交 */
  username?: string
}>()

const theme = useThemeVars()
const you = computed(() => (props.username ? "" : "你"))

const problemLink = computed(() => `/problem/${props.item.displayId}`)
const submissionLink = computed(() => ({
  path: "/submission",
  query: props.username
    ? { problem: props.item.displayId, username: props.username, exactUsername: "1" }
    : { problem: props.item.displayId, myself: "1" },
}))

const detail = computed(() => {
  const item = props.item
  const rank =
    props.inLesson && item.rank && item.classSolved
      ? `班上第 ${item.rank} 个做对（${item.classSolved} 人做对）`
      : ""
  if (item.status === "first") return ["一次就对", rank]
  if (item.status === "tries") return [`交了 ${item.attempts} 次才对`, rank]
  if (item.status === "fail") {
    const last = statusName(item.lastResult)
    return [`交了 ${item.attempts} 次还没做对`, last ? `最后一次${last}` : ""]
  }
  return [
    `这节课的题，${you.value}还没交`,
    item.classSolved ? `班上 ${item.classSolved} 人做对` : "",
  ]
})
</script>

<template>
  <n-popover trigger="hover" :delay="200" :show-arrow="false" placement="bottom-start">
    <template #trigger>
      <router-link :to="username ? submissionLink : problemLink" class="chip" :class="item.status">
        <Icon
          v-if="item.status === 'first'"
          icon="ph:check-bold"
          class="check"
          aria-label="一次就对"
        />
        <span class="title">{{ item.title }}</span>
        <span v-if="item.status === 'tries'" class="count">交 {{ item.attempts }} 次</span>
        <span v-else-if="item.status === 'fail'" class="count"
          >没做对 · {{ item.attempts }} 次</span
        >
        <span v-else-if="item.status === 'none'" class="count">没交</span>
      </router-link>
    </template>
    <div class="tip">
      <span>{{ detail.filter(Boolean).join(" · ") }}</span>
      <router-link v-if="item.status !== 'none'" :to="submissionLink"
        >{{ username ? "看提交" : "看你的提交" }} ›</router-link
      >
      <router-link v-else-if="!username" :to="problemLink">去做 ›</router-link>
    </div>
  </n-popover>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 30px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor1");
  text-decoration: none;
  white-space: nowrap;
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
}

.count {
  flex-shrink: 0;
  font-size: var(--oj-fs-meta);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.check {
  flex-shrink: 0;
  color: #18a058;
}

.first {
  background: rgba(24, 160, 88, 0.12);
}

.tries {
  background: rgba(240, 160, 32, 0.15);
}

.tries .count {
  color: #b86e00;
}

.fail {
  background: rgba(208, 48, 80, 0.09);
  border-color: rgba(208, 48, 80, 0.3);
}

.fail .count {
  color: #c0283f;
}

.none {
  border: 1px dashed v-bind("theme.borderColor");
  color: v-bind("theme.textColor3");
}

.chip:hover {
  filter: brightness(0.97);
}

.tip {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--oj-fs-meta);
}

.tip a {
  color: #18a058;
  text-decoration: none;
  white-space: nowrap;
}
</style>
