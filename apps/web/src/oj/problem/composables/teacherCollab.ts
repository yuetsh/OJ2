import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
import { useUserStore } from "shared/store/user"
import { useProblemPageContext } from "./problemPageContext"

/**
 * 老师正在这道题上协作：编辑器里是**学生的**代码，「我的提交」看的是学生的，
 * 跳走这一页协作就断了（所以跳转都开新标签，设计文档第 9 节）。
 */
export function useTeacherCollab() {
  const userStore = useUserStore()
  const collabHere = useCollabHere()
  return computed(() => userStore.isTeacherOrAbove && collabHere.value)
}

/**
 * 协作房间开在这道题上（老师、学生两边都算）。比赛入口一律不算：房间只记了题号，
 * 比赛题号和公开题撞号是常态，见 problemPageContext 的 `collab`
 */
export function useCollabHere() {
  const collabStore = useCollabStore()
  const problemStore = useProblemStore()
  const ctx = useProblemPageContext()
  return computed(
    () =>
      ctx.value.collab &&
      collabStore.room !== null &&
      collabStore.room.problemId === problemStore.problem?._id,
  )
}
