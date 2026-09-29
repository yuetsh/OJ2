export const judgeQueueName = "judge-submission"

export interface JudgeJobData {
  submissionId: string
  problemId: number
  /**
   * 重判时带上**重判之前**的结果。落库时靠它只做差量（见 run.ts 的 persistResult）：
   * 原来这条已经记过一次账，重判再当成新提交记一遍，题目和个人的提交数就多一。
   * 新提交不带。
   */
  rejudgedFrom?: number
}
