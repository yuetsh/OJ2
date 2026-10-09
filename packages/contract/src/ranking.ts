import { z } from "zod"

import { sampleUserSchema } from "./common"

/**
 * 排名页（设计稿「排名重设计」G1–G3）。用户要的是**激发竞争、一眼看出排名**，所以：
 *
 * - **同样多不并列**：做对多的在前，一样多的**先做到的在前**（`reachedAt` 早的在前）。
 *   课堂驱动下一个班十几个人同分是常态，原来按「提交少的在前」排等于罚多试的人；
 *   按先后排，名次差的是「这节课谁先做完」。
 * - 「做对」= 这道题**第一次**做对落在这段时间里（比赛里的提交不算），老题重交不算成绩。
 */
export const rankScopeSchema = z.enum(["class", "grade", "all"])
export const rankPeriodSchema = z.enum(["week", "term", "all"])

export const rankRowSchema = z.object({
  rank: z.number().int().positive(),
  user: sampleUserSchema,
  /** 自己上传的头像；还是默认头像时为 null，前端画名字最后一个字 */
  avatar: z.string().nullable(),
  className: z.string().nullable(),
  solved: z.number().int().nonnegative(),
  /** 做到这个数的时刻（最后一道新做对的题）；一道没做对时为 null */
  reachedAt: z.string().nullable(),
  /**
   * 比 `changeSince` 那一刻升了几名，正数是升。那时还一道没做对（不在榜上）时为 null ——
   * 从无到有不算「升了几名」，否则开学第一周人人都是 ↑30。
   */
  change: z.number().int().nullable(),
})

/** 我和对手每周的名次，给「我和对手的名次」那张走势图 */
export const rankTrendSchema = z.object({
  /** 每个点的时刻（周一零点，也就是上周日晚上），最后一个是现在 */
  points: z.array(z.string()),
  series: z.array(
    z.object({
      userId: z.number().int(),
      /** 和 points 一一对应；那时还没上榜为 null */
      ranks: z.array(z.number().int().positive().nullable()),
    }),
  ),
})

export const rankBoardSchema = z.object({
  scope: rankScopeSchema,
  period: rankPeriodSchema,
  /** 本班 = 班号；本年级 = 年级（班号前两位，如 "25"）；全服 = null */
  className: z.string().nullable(),
  /** 这段时间从哪一刻算起；「全部」为 null */
  start: z.string().nullable(),
  /** `change` 拿哪一刻比：这周 = 今天零点，这学期 / 全部 = 本周一零点 */
  changeSince: z.string(),
  /** 榜上一共几个人。本班把一道没做对的也算上（全班名单），本年级 / 全服只算做对过的 */
  total: z.number().int().nonnegative(),
  /**
   * 本班、或者带了 `full=1` 时是全部；否则是前面一段 + 我附近一段（`complete = false`），
   * 中间折起来，按名次断开的地方就是折叠处
   */
  rows: z.array(rankRowSchema),
  complete: z.boolean(),
  /** 我在这张榜上的那一行。没登录、老师、不计入排名、或者这段时间一道没做对时为 null */
  me: rankRowSchema.nullable(),
  /** 名次紧挨在我前面、后面的人 */
  ahead: rankRowSchema.nullable(),
  behind: rankRowSchema.nullable(),
  /** 只有「这学期」「全部」且有 me 时才有：这周清零，画走势没意义 */
  trend: rankTrendSchema.nullable(),
  /** 我被老师设成了不计入排名（学生自己看得到这句话，别人看不到他） */
  hidden: z.boolean(),
  /** 老师看本班时：这个班不计入排名的人。其余情况为空 */
  hiddenUsers: z.array(sampleUserSchema),
})

/** 班级对抗：人均做对，按这学期算；`weekGain` 是这周人均涨了多少 */
export const classBattleItemSchema = z.object({
  rank: z.number().int().positive(),
  className: z.string(),
  members: z.number().int().positive(),
  perCapita: z.number(),
  weekGain: z.number(),
})

/** 本班每周冠军：最近几个已经结束的周，每周做对新题最多的人 */
export const weeklyChampionSchema = z.object({
  weekStart: z.string(),
  user: sampleUserSchema,
  avatar: z.string().nullable(),
  solved: z.number().int().positive(),
})

export const rankHiddenRequestSchema = z.object({
  hidden: z.boolean(),
})

export type RankScope = z.infer<typeof rankScopeSchema>
export type RankPeriod = z.infer<typeof rankPeriodSchema>
export type RankRow = z.infer<typeof rankRowSchema>
export type RankTrend = z.infer<typeof rankTrendSchema>
export type RankBoard = z.infer<typeof rankBoardSchema>
export type ClassBattleItem = z.infer<typeof classBattleItemSchema>
export type WeeklyChampion = z.infer<typeof weeklyChampionSchema>
export type RankHiddenRequest = z.infer<typeof rankHiddenRequestSchema>
