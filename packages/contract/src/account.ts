import { z } from "zod"

import { sampleUserSchema } from "./common"
import { userProfileSchema } from "./auth"

export const registerRequestSchema = z.object({
  username: z.string().trim().min(1).max(32),
  email: z.email().max(64),
  password: z.string().min(6).max(20),
})

export const updateProfileRequestSchema = z.object({
  realName: z.string().max(32).nullable().optional(),
  avatar: z.string().max(256).optional(),
  mood: z.string().max(256).nullable().optional(),
})

export const metricsSchema = z.object({
  now: z.string(),
  latest: z.string(),
  first: z.string(),
  /** 有提交的日历天数（东八区），不是首末提交之间跨了多少天 */
  activeDays: z.number().int(),
})

export const rankProfileSchema = z.object({
  id: z.number().int(),
  user: sampleUserSchema,
  acceptedNumber: z.number().int(),
  submissionNumber: z.number().int(),
  mood: z.string().nullable(),
  /**
   * 在线与否。**null 表示「这个调用方不该知道」** —— 学生之间互相盯着谁在刷题
   * 不合适，所以只对老师及以上下发 true/false，其余一律 null。
   * 三态是有意的：写成 boolean 的话，学生看到的 false 和真的离线分不开。
   */
  isOnline: z.boolean().nullable().default(null),
})

/**
 * 周榜的一行。`solvedCount` 是**本周首次 AC 的题目数** —— 不是「本周 AC 过的去重题数」。
 * 后者会把上周就做出来的题重交一次也算成本周成绩，等于给刷榜留了个口子；
 * 而周榜的全部意义是「这一周你往前走了多少」，只有首次通过才算往前走。
 */
export const weeklyRankItemSchema = z.object({
  user: sampleUserSchema,
  solvedCount: z.number().int().positive(),
  submissionCount: z.number().int().nonnegative(),
  rank: z.number().int().positive(),
})

export const weeklyRankSchema = z.object({
  /** 本周一 0:00（东八区）对应的 UTC 时刻，前端拿它显示统计区间 */
  start: z.string(),
  scope: z.enum(["global", "class"]),
  /** `scope = "class"` 时是我的班号，全服榜为 null */
  className: z.string().nullable(),
  /** 本周有新增 AC 的总人数。榜面只回前几名，这个数是全量 */
  total: z.number().int().nonnegative(),
  results: z.array(weeklyRankItemSchema),
  /**
   * 我这周的位置。**本周一题没做出来就是 null**，和「没登录」「身份不入榜」同一个值 ——
   * 这三种情况前端都该显示「做出 1 题就能上榜」那句，不需要区分。
   */
  me: weeklyRankItemSchema.nullable(),
})

export const problemRankSchema = z.object({
  className: z.string(),
  rank: z.number().int(),
  classAcCount: z.number().int().nonnegative(),
  allAcCount: z.number().int().nonnegative(),
})

export const publicProfileSchema = userProfileSchema

export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
export type ProblemRank = z.infer<typeof problemRankSchema>
export type RankProfile = z.infer<typeof rankProfileSchema>
export type WeeklyRankItem = z.infer<typeof weeklyRankItemSchema>
export type WeeklyRank = z.infer<typeof weeklyRankSchema>
export type Metrics = z.infer<typeof metricsSchema>

export type PublicProfile = z.infer<typeof publicProfileSchema>

/**
 * 知识点地图：每个知识点做对了几道、在第几档。只给自己看（`/me/knowledge`），不出排名。
 *
 * 档位 0–4：0 没碰过、1 入门（做对 1 道）、2 会了（3 道）、3 熟练、4 精通，后两档的
 * 门槛按这个知识点的题量缩放（见 routes/account.ts 的 levelThresholds）。「入门」那一档
 * 是为「只做对一两道」的学生加的：2025 秋一学期一档都没升的 151 人里，71 人做对过带
 * 标签的题，只是没到 3 道，只看结果的档位设计下他们什么都看不到。
 */
export const knowledgeLevelSchema = z.object({
  name: z.string(),
  /** 这个知识点下公开的题库题数（不含比赛题） */
  problemCount: z.number().int(),
  solved: z.number().int(),
  level: z.number().int(),
  /** 本周一 0 点时的档位，和 level 不同就是「本周升级了」 */
  levelAtWeekStart: z.number().int(),
  /** 升到下一档要累计做对几道（总数，不是差值）；已经是最高档为 null */
  nextAt: z.number().int().nullable(),
})

export const knowledgeMapSchema = z.object({
  /** 题数 ≥ 10 的知识点，按题数从多到少 */
  tags: z.array(knowledgeLevelSchema),
  /**
   * 同班 30% 以上的同学点亮过的知识点。「还没碰过」只从这里挑 —— 不然学 Python 的班
   * 会看到「C 语言：还没碰过」。没有班级时为空。
   */
  classTouched: z.array(z.string()),
})

export type KnowledgeLevel = z.infer<typeof knowledgeLevelSchema>
export type KnowledgeMap = z.infer<typeof knowledgeMapSchema>
