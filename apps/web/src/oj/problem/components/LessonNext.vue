<script setup lang="ts">
import SectionHead from './SectionHead.vue'
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
  <!--
    设计稿「题目页观感」结果 X：「接着做」一节，一句话说还剩几道，一个 44px 的大按钮写下一题。
    原来是一张浅绿卡片：左边竖栏已经有这节课的进度，不用再框一块
  -->
  <section v-if="lesson" class="lesson-next">
    <SectionHead icon="next">接着做</SectionHead>
    <template v-if="lesson.next">
      <p class="text">
        {{ label }}还剩 {{ lesson.remaining }} 道，下一道 {{ lesson.next.problemDisplayId }}
        {{ lesson.next.myStatus === 'tried' ? '你做过，还没对' : '你还没做过' }}。
      </p>
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
      <p class="text">{{ label }}都做完了，一共 {{ lesson.total }} 道。<template v-if="!challenges">想接着练，可以去专题里挑一个。</template></p>
      <router-link v-if="!challenges" to="/problemset" class="next secondary">
        <span class="next-label">去专题继续练</span>
      </router-link>
    </template>
  </section>
  <!-- 做完了：先给这节课里还能挑战的，再给专题（设计稿 StkDone）。挑战一条都没有时只剩专题那句 -->
  <template v-if="lesson && !lesson.next && challenges">
    <ChallengeList :problem-ids="lessonProblemIds" :language="language" :refresh-key="refreshKey" />
    <router-link to="/problemset" class="more">去专题继续练</router-link>
  </template>
</template>

<style scoped>
.lesson-next {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
}

.text {
  margin: 0 0 12px;
  font-size: 16px;
  line-height: 1.75;
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
  border-radius: 8px;
  background-color: v-bind('theme.primaryColor');
  color: v-bind('buttonText');
  font-size: 16px;
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
