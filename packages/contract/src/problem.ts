import { z } from "zod"

/** 题目列表项。字段取自 problem 表，只含列表页需要的列。 */
export const problemSummarySchema = z.object({
  id: z.number().int(),
  _id: z.string(), // 展示用编号，与自增 id 不同
  title: z.string(),
  difficulty: z.string(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
})

export type ProblemSummary = z.infer<typeof problemSummarySchema>
