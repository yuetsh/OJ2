import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
import { useUserStore } from "shared/store/user"

/**
 * 老师正在这道题上协作：编辑器里是**学生的**代码，「我的提交」看的是学生的，
 * 跳走这一页协作就断了（所以跳转都开新标签，设计文档第 9 节）。
 */
export function useTeacherCollab() {
  const userStore = useUserStore()
  const collabStore = useCollabStore()
  const problemStore = useProblemStore()
  return computed(
    () =>
      userStore.isTeacherOrAbove &&
      collabStore.room !== null &&
      collabStore.room.problemId === problemStore.problem?._id,
  )
}
