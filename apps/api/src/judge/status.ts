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

/**
 * 判题状态的中文名，和前端 `utils/constants.ts` 的 `JUDGE_STATUS` 一致，两边必须同步。
 * 目前只用在喂给模型的 prompt 里 —— 原来那里拼的是裸状态码（`结果：-1`），
 * 模型根本不知道 -1 是「答案错误」还是别的什么，等于白给一条信息。
 */
export const JUDGE_STATUS_NAME: Record<number, string> = {
  [JudgeStatus.COMPILE_ERROR]: "编译失败",
  [JudgeStatus.WRONG_ANSWER]: "答案错误",
  [JudgeStatus.ACCEPTED]: "答案正确",
  [JudgeStatus.CPU_TIME_LIMIT_EXCEEDED]: "运行超时",
  [JudgeStatus.REAL_TIME_LIMIT_EXCEEDED]: "运行超时",
  [JudgeStatus.MEMORY_LIMIT_EXCEEDED]: "内存超限",
  [JudgeStatus.RUNTIME_ERROR]: "运行时错误",
  [JudgeStatus.SYSTEM_ERROR]: "系统错误",
  [JudgeStatus.PENDING]: "等待评分",
  [JudgeStatus.JUDGING]: "正在评分",
  [JudgeStatus.PARTIALLY_ACCEPTED]: "部分正确",
  [JudgeStatus.AST_CHECK_FAILED]: "答案正确，但语法未通过",
}

export function judgeStatusName(result: number) {
  return JUDGE_STATUS_NAME[result] ?? `未知状态(${result})`
}

/**
 * 还没判完的两个状态。这类提交**已经落库但结果未定**，凡是算「正确率」的地方都得把
 * 它们从分母里摘掉 —— 否则全班同时交卷的那几秒，分母涨了分子没涨，正确率凭空掉一截。
 * 人数口径不受影响：交了但还在判的学生仍然算「交过」，不该被点名成「没做」。
 */
export const UNJUDGED_RESULTS: number[] = [JudgeStatus.PENDING, JudgeStatus.JUDGING]

/**
 * **不**计入「这道题失败了几次」的状态。除了通过（含 AST_CHECK_FAILED，那也是答案对了）
 * 和还没判完的两个，还排掉 SYSTEM_ERROR —— 判题机自己崩了不是学生的问题，
 * 不该推着 AI 提示的解锁进度往前走。
 */
export const NON_FAILURE_RESULTS: number[] = [
  JudgeStatus.ACCEPTED,
  JudgeStatus.AST_CHECK_FAILED,
  JudgeStatus.PENDING,
  JudgeStatus.JUDGING,
  JudgeStatus.SYSTEM_ERROR,
]
