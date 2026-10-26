import { getSubmission } from 'oj/api'
import { SubmissionStatus } from 'utils/constants'
import type { Submission } from 'utils/types'
import type { Tone } from 'shared/composables/tone'

/**
 * 一次提交一格的那串方块（统计页的 AttemptSquares、课堂看板做对格子的轨迹）共用的两样：
 * 方块的颜色，和停上去看代码时拉的提交。
 */

/** 对了绿；编译失败、运行时错误、语法规则没过、部分通过橙；判题中蓝；其余红 */
export function attemptTone(result: number): Tone {
  if (result === SubmissionStatus.accepted) return 'success'
  if (
    result === SubmissionStatus.compile_error ||
    result === SubmissionStatus.runtime_error ||
    result === SubmissionStatus.ast_check_failed ||
    result === SubmissionStatus.partial_accepted
  ) {
    return 'warning'
  }
  if (result === SubmissionStatus.pending || result === SubmissionStatus.judging) return 'info'
  return 'error'
}

/**
 * 代码按提交 id 缓存，整页共用：交了就不会再变，老师在一排方块之间来回对比时
 * 不用每次都等网络。失败的不进缓存，下次停上去再试。
 */
const codeCache = new Map<string, Promise<Submission>>()

export function cachedSubmission(id: string) {
  let hit = codeCache.get(id)
  if (!hit) {
    hit = getSubmission(id)
    hit.catch(() => codeCache.delete(id))
    codeCache.set(id, hit)
  }
  return hit
}
