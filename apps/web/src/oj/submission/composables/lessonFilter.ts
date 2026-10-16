import { computed, ref, type Ref } from "vue"
import { getClassLesson } from "oj/api"
import { classLabel } from "utils/classes"
import type { ClassLesson } from "utils/types"
import type { SubmissionQuery } from "./listQuery"

/** 提交列表的「这节课」：一键筛到 班级 + 这节课的题 + 今天。班级和题的取法同课堂看板 */
export function useLessonFilter(options: {
  query: SubmissionQuery
  flowMode: Ref<boolean>
  info: (text: string) => void
}) {
  const { query } = options
  const lesson = ref<ClassLesson | null>(null)
  const lessonIds = computed(
    () => lesson.value?.problems.map((problem) => problem.problemDisplayId).join(",") ?? "",
  )
  const lessonActive = computed(
    () =>
      !!lesson.value?.className &&
      !!lesson.value.problems.length &&
      query.className === lesson.value.className &&
      query.problem === lessonIds.value &&
      query.today === "1",
  )
  const lessonLoading = ref(false)

  async function toggleLesson() {
    if (lessonActive.value) {
      query.problem = ""
      query.today = "0"
      // 「这节课」顺带筛上的语言一起放掉；老师自己另选的别动
      if (lesson.value?.language && query.language === lesson.value.language) query.language = ""
      return
    }
    lessonLoading.value = true
    try {
      const res = await getClassLesson(query.className || undefined)
      if (!res.className) {
        options.info("猜不出是哪个班在上课，先在班级里选一个")
        return
      }
      query.className = res.className
      if (!res.problems.length) {
        options.info(
          `${classLabel(res.className)}今天还没有布置题，也还没人交。可以先去课堂看板布置`,
        )
        return
      }
      lesson.value = res
      query.problem = lessonIds.value
      query.today = "1"
      // 老师布置时选了语言：看板上只数这个语言交的，列表也只列它（流程图那边不动）
      if (res.language && !options.flowMode.value) query.language = res.language
    } finally {
      lessonLoading.value = false
    }
  }

  return { lesson, lessonActive, lessonLoading, toggleLesson }
}
