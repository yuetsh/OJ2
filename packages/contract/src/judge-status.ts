import { z } from "zod"

/**
 * 判题状态码 —— **前后端唯一的一份**。
 *
 * 这些整数是落库的值：12 万条历史提交的 `submission.result` 就是它们，判题沙箱回的
 * 也是这套编码，所以只能新增、不能改已有的含义。后端 `judge/status.ts` 从这里再导出，
 * 前端 `utils/constants.ts` 的 `SubmissionStatus` 用类型断言逐条对齐这里。
 */
export const JudgeStatus = {
  COMPILE_ERROR: -2,
  WRONG_ANSWER: -1,
  ACCEPTED: 0,
  CPU_TIME_LIMIT_EXCEEDED: 1,
  REAL_TIME_LIMIT_EXCEEDED: 2,
  MEMORY_LIMIT_EXCEEDED: 3,
  RUNTIME_ERROR: 4,
  SYSTEM_ERROR: 5,
  PENDING: 6,
  JUDGING: 7,
  PARTIALLY_ACCEPTED: 8,
  AST_CHECK_FAILED: 10,
} as const

export type JudgeStatusValue = (typeof JudgeStatus)[keyof typeof JudgeStatus]

// 同名的类型：原来契约里就有 `type JudgeStatus`（各处按类型引用），值与类型同名合并
export type JudgeStatus = JudgeStatusValue

export const judgeStatusSchema = z.literal(
  Object.values(JudgeStatus) as [JudgeStatusValue, ...JudgeStatusValue[]],
)
