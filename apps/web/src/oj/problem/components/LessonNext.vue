<script setup lang="ts">
import { useLessonStore } from "oj/store/lesson"

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
}>()

const lessonStore = useLessonStore()

// 一般课堂条早就拉过了，这里只是兜底（旧了才拉）
onMounted(() => lessonStore.load())

const lesson = computed(() => lessonStore.nextAfter(props.problemDisplayId))

const label = computed(() => lessonStore.label)
</script>

<template>
  <n-card v-if="lesson" size="small" embedded class="lesson-next">
    <n-flex v-if="lesson.next" align="center" justify="space-between" :wrap="false">
      <n-text depth="3">{{ label }}还剩 {{ lesson.remaining }} 道</n-text>
      <router-link :to="`/problem/${lesson.next.problemDisplayId}`">
        <n-button type="primary">
          下一题：{{ lesson.next.problemDisplayId }} {{ lesson.next.title }}
        </n-button>
      </router-link>
    </n-flex>
    <n-flex v-else align="center" justify="space-between">
      <n-text>{{ label }}都做完了，一共 {{ lesson.total }} 道 🎉</n-text>
      <router-link to="/problemset">
        <n-button secondary>去题单继续练</n-button>
      </router-link>
    </n-flex>
  </n-card>
</template>

<style scoped>
.lesson-next {
  margin-top: 12px;
  max-width: 560px;
}

/* 题目名可能很长（带 emoji 的、二十几个字的），按钮别把结果面板撑宽 */
.lesson-next :deep(.n-button__content) {
  display: block;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
