<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { useLessonStore } from "oj/store/lesson"
import { useProblemJump } from "shared/composables/problemJump"
import { useUserStore } from "shared/store/user"
import type { ClassActivityProblem } from "utils/types"
import { zonedParts } from "utils/functions"

/**
 * 顶栏的题号框：老师报完题号，学生在哪一页都能直接敲，不用先回首页或题目列表。
 *
 * 点进框里先列出「这节课的题」（和首页「班里在做」、题目页课堂条同一份数据），
 * 没听清题号的学生不用问同桌；开始输入就只留对得上的。回车的行为没变：题号对上就
 * 直达，对不上去题库搜（见 useProblemJump）。
 *
 * 列表只在**今天**有课、而且**不在题目页**时出现：接口会往前找最近 7 天里有课的那天，
 * 周一早上拿到的是上周五的题，那不叫「这节课」；题目页顶上已经有课堂条，不再重复一份。
 */
const props = defineProps<{ compact?: boolean }>()

const route = useRoute()
const router = useRouter()
const theme = useThemeVars()
const isDark = useDark()
const userStore = useUserStore()
const lessonStore = useLessonStore()

const { jump, jumping } = useProblemJump()
const keyword = ref("")
const focused = ref(false)
const input = useTemplateRef<{ blur: () => void }>("input")

/** 题目页的三种入口（题库 / 比赛 / 题单）顶上都有自己的上下文条 */
const PROBLEM_PAGES = new Set(["problem", "contest problem", "problemset problem"])
const onProblemPage = computed(() => PROBLEM_PAGES.has(String(route.name)))

function todayKey() {
  const now = zonedParts(new Date())!
  return `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`
}

const lesson = computed(() => {
  const activity = lessonStore.activity
  if (!activity?.problems.length || activity.day !== todayKey()) return null
  return activity
})

const done = computed(
  () => lesson.value?.problems.filter((item) => item.myStatus === "accepted").length ?? 0,
)

/** 「下一道」是第一道还没做对的 —— 不在题目页上，没有「当前这道」可以往后数 */
const nextId = computed(
  () => lesson.value?.problems.find((item) => item.myStatus !== "accepted")?.problemDisplayId,
)

const filtered = computed(() => {
  const list = lesson.value?.problems ?? []
  const text = keyword.value.trim().toLowerCase()
  if (!text) return list
  return list.filter(
    (item) =>
      item.problemDisplayId.toLowerCase().includes(text) || item.title.toLowerCase().includes(text),
  )
})

const open = computed(() => focused.value && !onProblemPage.value && filtered.value.length > 0)

function handleFocus() {
  focused.value = true
  // 接口要求登录；store 自己有两分钟的缓存，来回点不会重复拉
  if (userStore.isAuthed) lessonStore.load()
}

function close() {
  input.value?.blur()
  keyword.value = ""
}

async function handleEnter() {
  const text = keyword.value
  close()
  await jump(text)
}

function openProblem(item: ClassActivityProblem) {
  close()
  router.push(`/problem/${item.problemDisplayId}`)
}

const STATUS_ICON: Record<ClassActivityProblem["myStatus"], string> = {
  accepted: "ph:check-circle-fill",
  tried: "ph:warning-circle-fill",
  none: "ph:circle",
}
const statusColor = computed<Record<ClassActivityProblem["myStatus"], string>>(() => ({
  accepted: theme.value.successColor,
  tried: theme.value.warningColor,
  none: theme.value.textColor3,
}))

const tone = computed(() => ({
  label: isDark.value ? theme.value.primaryColor : theme.value.primaryColorPressed,
  nextBg: isDark.value ? "rgba(99, 226, 183, 0.10)" : "#f3f9f5",
  tagBg: isDark.value ? "rgba(99, 226, 183, 0.16)" : "#e7f5ed",
}))

/**
 * 面板是 n-popover 传送到 body 下的，不在本组件根元素底下 —— scoped 样式里的 v-bind
 * 生成的 CSS 变量挂在根元素上，面板取不到（实测整块透明）。所以变量直接挂在面板上
 */
const panelVars = computed(() => ({
  "--jb-popoverColor": theme.value.popoverColor,
  "--jb-borderRadius": theme.value.borderRadius,
  "--jb-boxShadow2": theme.value.boxShadow2,
  "--jb-dividerColor": theme.value.dividerColor,
  "--jb-label": tone.value.label,
  "--jb-textColor3": theme.value.textColor3,
  "--jb-textColor1": theme.value.textColor1,
  "--jb-hoverColor": theme.value.hoverColor,
  "--jb-nextBg": tone.value.nextBg,
  "--jb-textColor2": theme.value.textColor2,
  "--jb-tagBg": tone.value.tagBg,
}))
</script>

<template>
  <n-popover trigger="manual" :show="open" placement="bottom-start" :show-arrow="false" raw>
    <template #trigger>
      <n-input
        ref="input"
        v-model:value="keyword"
        class="jump"
        :class="{ compact: props.compact }"
        placeholder="输入题号直达"
        :loading="jumping"
        @focus="handleFocus"
        @blur="focused = false"
        @keyup.enter="handleEnter"
        @keydown.esc="close"
      >
        <template #prefix>
          <Icon icon="ph:magnifying-glass" />
        </template>
      </n-input>
    </template>

    <!-- mousedown 不让输入框失焦：一失焦 open 就变 false，面板先没了，click 落空 -->
    <div class="panel" :style="panelVars" @mousedown.prevent>
      <div class="head">
        <span class="label">{{ lessonStore.label }}</span>
        <span class="count">做完 {{ done }}/{{ lesson?.problems.length }}</span>
      </div>
      <a
        v-for="item in filtered"
        :key="item.problemDisplayId"
        :href="`/problem/${item.problemDisplayId}`"
        class="row"
        :class="{ next: item.problemDisplayId === nextId, accepted: item.myStatus === 'accepted' }"
        @click.prevent="openProblem(item)"
      >
        <Icon
          :icon="STATUS_ICON[item.myStatus]"
          :width="18"
          :color="statusColor[item.myStatus]"
          class="status"
        />
        <span class="id">{{ item.problemDisplayId }}</span>
        <span class="title">{{ item.title }}</span>
        <span v-if="item.problemDisplayId === nextId" class="tag">下一道</span>
      </a>
      <div class="foot">
        {{ keyword.trim() ? "回车按题号直达，对不上就去题库搜" : "也可以直接输入题号，回车打开" }}
      </div>
    </div>
  </n-popover>
</template>

<style scoped>
.jump {
  width: 240px;
}

.jump.compact {
  width: 160px;
}

.panel {
  width: 320px;
  margin-top: 4px;
  padding: 4px 0;
  display: flex;
  flex-direction: column;
  background: var(--jb-popoverColor);
  border-radius: var(--jb-borderRadius);
  box-shadow: var(--jb-boxShadow2);
  font-size: 14px;
}

.head {
  height: 34px;
  box-sizing: border-box;
  margin-bottom: 4px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--jb-dividerColor);
  font-size: 13px;
}

.label {
  font-weight: 600;
  color: var(--jb-label);
}

.count {
  color: var(--jb-textColor3);
}

.row {
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--jb-textColor1);
  text-decoration: none;
}

.row:hover {
  background: var(--jb-hoverColor);
}

.row.next {
  background: var(--jb-nextBg);
}

.row.accepted {
  color: var(--jb-textColor3);
}

.status {
  flex: none;
}

.id {
  flex: none;
  min-width: 38px;
  font-family: Consolas, Monaco, monospace;
  color: var(--jb-textColor2);
}

.title {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  flex: none;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--jb-tagBg);
  color: var(--jb-label);
  font-size: 12px;
}

.foot {
  margin-top: 4px;
  padding: 8px 12px 6px;
  border-top: 1px solid var(--jb-dividerColor);
  font-size: 12px;
  color: var(--jb-textColor3);
}
</style>
