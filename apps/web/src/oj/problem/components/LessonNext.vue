<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import { useLessonStore } from 'shared/store/lesson'
import ChallengeList from './ChallengeList.vue'

/**
 * 通过之后告诉学生「这节课的下一题是哪道」。
 *
 * 72% 的提交一次就通过，每次通过之后学生都得回首页、或者再问一遍题号去找下一道。
 * 这节课的题就是首页「班里在做」那几道，和左栏顶上的课堂条读同一份（lesson store）；
 * 通过的那一刻课堂条已经把这道标成做完、并且重拉了一次。
 *
 * 「下一道」怎么算见 lesson store 的 nextAfter，AC 后的点评弹窗里那个「下一题」也用它。
 *
 * 这道题不在这节课的列表里（学生在做别的）就什么都不显示。
 */
const props = defineProps<{
  /** 当前这道题的展示题号 */
  problemDisplayId: string
  /** 刚做对用的语言：挑战按语言分 */
  language: string
  /** 刚做对的那次提交，换了就重拉「还能挑战」 */
  refreshKey: string
  /** 这个入口给不给挑战（见 problemPageContext） */
  challenges: boolean
}>()

const lessonStore = useLessonStore()
const theme = useThemeVars()
// 暗色主题的主色是浅薄荷绿，按钮上的白字看不清，换深色字（和 Naive 自己的主按钮一样）
const isDark = useDark()
const buttonText = computed(() => (isDark.value ? 'rgba(0, 0, 0, 0.85)' : '#fff'))

// 一般课堂条早就拉过了，这里只是兜底（旧了才拉）
onMounted(() => lessonStore.load())

const lesson = computed(() => lessonStore.nextAfter(props.problemDisplayId))

// 设计稿和上下文条都叫「这节课」，不区分是老师布置的还是从同班提交推断的
const label = '这节课'

/** 这节课的几道题：都做完了以后，这几道里还能挑战的列出来（设计稿 StkDone） */
const lessonProblemIds = computed(() => lessonStore.activity?.problems.map((item) => item.problemDisplayId) ?? [])
</script>

<template>
  <!-- 设计稿「答案正确：下一题在结果页签里」：浅绿卡片，一个 44px 的大按钮 -->
  <div v-if="lesson" class="lesson-next">
    <template v-if="lesson.next">
      <div class="text">
        <span class="headline">{{ label }}还剩 {{ lesson.remaining }} 道</span>
        <span class="detail">
          {{ lesson.next.problemDisplayId }}
          {{ lesson.next.myStatus === 'tried' ? '你做过，还没对' : '你还没做过' }}
        </span>
      </div>
      <router-link :to="`/problem/${lesson.next.problemDisplayId}`" class="next">
        <span class="next-label">下一题：{{ lesson.next.problemDisplayId }} {{ lesson.next.title }}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </router-link>
    </template>
    <template v-else>
      <div class="text">
        <span class="headline">{{ label }}都做完了，一共 {{ lesson.total }} 道</span>
        <span v-if="!challenges" class="detail">想接着练，可以去题单里挑一个</span>
      </div>
      <router-link v-if="!challenges" to="/problemset" class="next secondary">
        <span class="next-label">去题单继续练</span>
      </router-link>
    </template>
  </div>
  <!-- 做完了：先给这节课里还能挑战的，再给题单（设计稿 StkDone）。挑战一条都没有时只剩题单那句 -->
  <template v-if="lesson && !lesson.next && challenges">
    <ChallengeList :problem-ids="lessonProblemIds" :language="language" :refresh-key="refreshKey" />
    <router-link to="/problemset" class="more">去题单继续练</router-link>
  </template>
</template>

<style scoped>
.lesson-next {
  margin-top: 12px;
  padding: 16px 18px;
  border-radius: 8px;
  background-color: rgba(24, 160, 88, 0.07);
  border: 1px solid rgba(24, 160, 88, 0.25);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.headline {
  font-size: 15px;
  font-weight: 600;
}

.detail {
  font-size: 13px;
  color: v-bind('theme.textColor2');
}

.next {
  align-self: flex-start;
  max-width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 20px;
  border-radius: 6px;
  background-color: v-bind('theme.primaryColor');
  color: v-bind('buttonText');
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}

.next:hover {
  background-color: v-bind('theme.primaryColorHover');
}

.next:focus-visible {
  outline: 2px solid v-bind('theme.primaryColorPressed');
  outline-offset: 2px;
}

.more {
  display: inline-block;
  margin-top: 12px;
  font-size: 14px;
  color: v-bind('theme.primaryColor');
}

.more:hover {
  text-decoration: underline;
}

.next.secondary {
  background-color: transparent;
  border: 1px solid v-bind('theme.primaryColor');
  color: v-bind('theme.primaryColorPressed');
}

/* 题目名可能很长（带 emoji 的、二十几个字的），按钮别把结果面板撑宽 */
.next-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
