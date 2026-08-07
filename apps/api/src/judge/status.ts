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

export function isAccepted(result: number) {
  return result === JudgeStatus.ACCEPTED || result === JudgeStatus.AST_CHECK_FAILED
}
