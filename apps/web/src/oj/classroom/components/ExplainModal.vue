<script lang="ts">
export interface ExplainPerson {
  userId: number
  username: string
  submissionId: string
  /** 错法的短名（errorKind），挂在名字后面 */
  label: string
}
</script>

<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { onKeyStroke } from "@vueuse/core"
import { useThemeVars } from "naive-ui"
import SubmissionView from "oj/submission/components/SubmissionView.vue"
import UserName from "shared/components/UserName.vue"
import type { ClassBoardProblem } from "utils/types"
import ProblemBrief from "./ProblemBrief.vue"

/**
 * 课堂看板「讲错误」（设计稿 BdOpen）：点一个红格子或错法堆里的名字打开。老师在讲台上
 * 一个个讲这道题错着的人，所以顶上是这几个人，← → 换人；下面和独立的提交详情页同一块
 * （代码占满宽、为什么错在后），只是不出名字那一行、点「第几次」就地换。
 *
 * 「题目」按钮：演示错误时题目和代码要并排（用户要的），点了左边出题目，再点收起。
 * 平时收着，代码照样占满宽。开没开记在这台电脑上，讲下一个人、下一道题还是那样
 */
const props = defineProps<{
  problem: ClassBoardProblem | null
  people: ExplainPerson[]
}>()
const show = defineModel<boolean>("show", { required: true })
const index = defineModel<number>("index", { required: true })

const theme = useThemeVars()
/**
 * 颜色走内联的 CSS 变量，不用 <style> 里的 v-bind()：n-modal 把内容挂到 body 下面，
 * v-bind 的变量挂在组件根上，传不过去（弹层底色整个透明）
 */
const vars = computed(() => ({
  "--card": theme.value.cardColor,
  "--text1": theme.value.textColor1,
  "--text2": theme.value.textColor2,
  "--text3": theme.value.textColor3,
  "--divider": theme.value.dividerColor,
  "--border": theme.value.borderColor,
  "--success": theme.value.successColor,
  "--hover": theme.value.hoverColor,
}))
const current = computed(() => props.people[index.value] ?? null)
const showProblem = useStorage("oj_explain_show_problem", false)

function step(delta: -1 | 1) {
  const next = index.value + delta
  if (next >= 0 && next < props.people.length) index.value = next
}

onKeyStroke(["ArrowLeft", "ArrowRight"], (event) => {
  if (!show.value || props.people.length < 2) return
  if (event.altKey || event.ctrlKey || event.metaKey) return
  event.preventDefault()
  step(event.key === "ArrowLeft" ? -1 : 1)
})
</script>

<template>
  <n-modal v-model:show="show" :auto-focus="false">
    <!-- 无 preset 的 n-modal 直接子节点要是普通元素 -->
    <div
      class="sheet"
      :style="vars"
      role="dialog"
      :aria-label="problem ? `讲 ${problem.problemDisplayId} 的错误` : '讲错误'"
    >
      <div class="top">
        <span v-if="problem" class="problem">
          <b>{{ problem.problemDisplayId }}</b> {{ problem.title }}
          <template v-if="people.length > 1"> · 错着的</template>
        </span>
        <div class="people">
          <button
            v-for="(person, i) in people"
            :key="person.userId"
            type="button"
            class="person"
            :class="{ on: i === index }"
            @click="index = i"
          >
            <UserName :username="person.username" />
            <span class="kind">{{ person.label }}</span>
          </button>
        </div>
        <span v-if="people.length > 1" class="keys"><kbd>←</kbd><kbd>→</kbd> 换人</span>
        <div class="spacer"></div>
        <n-button
          v-if="problem"
          :type="showProblem ? 'primary' : 'default'"
          :secondary="showProblem"
          @click="showProblem = !showProblem"
        >
          题目
        </n-button>
        <n-button
          v-if="current"
          tag="a"
          :href="'/submission/' + current.submissionId"
          target="_blank"
        >
          在新页面打开
        </n-button>
        <n-button quaternary aria-label="关闭" @click="show = false">
          <template #icon><Icon icon="ph:x-bold" /></template>
        </n-button>
      </div>
      <div class="body" :class="{ split: showProblem && problem }">
        <aside v-if="showProblem && problem" class="statement">
          <ProblemBrief :display-id="problem.problemDisplayId" />
        </aside>
        <div class="main">
          <SubmissionView v-if="current" :id="current.submissionId" embedded />
        </div>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.sheet {
  width: min(1240px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  box-sizing: border-box;
  padding: 18px 24px 24px;
  border-radius: 10px;
  background: var(--card);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.problem {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--text3);
  white-space: nowrap;
}

.problem b {
  color: var(--text2);
}

.people {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.person {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--divider);
  background: var(--card);
  color: var(--text1);
  font: inherit;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}

.person.on {
  border-color: var(--success);
  background: var(--hover);
}

.kind {
  font-size: 12px;
  color: var(--text3);
}

.keys {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text3);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

kbd {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--card);
  font: inherit;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.spacer {
  flex: 1 1 0;
}

.body.split {
  display: grid;
  grid-template-columns: minmax(300px, 2fr) minmax(0, 3fr);
  gap: 20px;
  align-items: start;
}

/* 题目自己滚：讲到代码后半段时题目还在旁边 */
.statement {
  position: sticky;
  top: 0;
  max-height: calc(100vh - 140px);
  overflow: auto;
  padding-right: 8px;
  color: var(--text1);
}

.main {
  min-width: 0;
}
</style>
