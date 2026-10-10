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

/** 我和前后一名每周的名次，给「我和前后一名的名次」那张走势图 */
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

/**
 * 班级详情（设计稿「班级详情 · 老师 / 学生」）。原来弹框里的四分位数、四分位距、标准差、
 * 综合分都去掉了，只留一眼看得懂的数：人均、中间那位同学、做对过的人、前后 10%、全班分布、
 * 每周人均和年级比。口径和排名页一样：这学期第一次做对的题，不计入排名的人不算。
 */
export const classDetailSchema = z.object({
  className: z.string(),
  /** 这学期从哪天算起 */
  start: z.string(),
  members: z.number().int().nonnegative(),
  /** 班级对抗里第几、一共几个班；这学期还没做对过题的班没有名次 */
  rank: z.number().int().positive().nullable(),
  battleSize: z.number().int().nonnegative(),
  perCapita: z.number(),
  /** 同年级在用的班（这学期做对过题）的人均；没有为 null */
  gradeAvg: z.number().nullable(),
  /** 中间那位同学做对几道 */
  median: z.number(),
  /** 这学期做对过至少 1 道的人数 */
  solvedMembers: z.number().int().nonnegative(),
  top10Avg: z.number(),
  bottom10Avg: z.number(),
  /** 人最多的那一档同分（至少 5 人才算「停在这」），没有为 null */
  plateau: z.object({ solved: z.number().int(), count: z.number().int() }).nullable(),
  /** 每个同学这学期做对几道，画分布点阵用 */
  distribution: z.array(z.number().int().nonnegative()),
  /** 这学期每周（周一起）人均新做对，和同年级在用的班平均比 */
  weeks: z.array(
    z.object({ weekStart: z.string(), perCapita: z.number(), gradeAvg: z.number().nullable() }),
  ),
  /** 要多关心的同学（这学期做对不到 3 道），只给老师；学生拿到的是 null */
  care: z
    .array(
      z.object({
        user: sampleUserSchema,
        avatar: z.string().nullable(),
        solved: z.number().int().nonnegative(),
        submissions: z.number().int().nonnegative(),
      }),
    )
    .nullable(),
})

export type ClassDetail = z.infer<typeof classDetailSchema>

/**
 * 班级 PK（设计稿「班级 PK 重设计」定稿）。用户定的：**两个班按「同一批题」对决，三个班以上
 * 按题对照，学生也能看**。
 *
 * 各班进度不同、布置的题不一样，比人均等于比谁开课早，所以主角是「同一批题」：
 * 一个班过半的人交过这道题就算这个班**布置过**；至少两个班布置过的题才拿来比，
 * 比的是**做对的人占全班几成**（整数百分比），高的那个班赢这道，显示一样就算平 ——
 * 不然 37/39 和 38/40 都显示 95%，皇冠却只给一边。口径和排名页一样：比赛里的提交不算，
 * 不计入排名的人分子分母都不算。
 */
export const classPkPeriodSchema = z.enum(["week", "term"])

export const classPkCellSchema = z.object({
  /** 这段时间交过这道题的人 */
  tried: z.number().int().nonnegative(),
  /** 这段时间做对了的人 */
  solved: z.number().int().nonnegative(),
  /** 第一次交就对的人 */
  firstTry: z.number().int().nonnegative(),
  submissions: z.number().int().nonnegative(),
  /** 做对的人占全班几成（整数百分比），比输赢就比它 */
  percent: z.number().int().nonnegative(),
  /** 一次就对：交过的人里第一次交就对的占几成 */
  firstPercent: z.number().int().nonnegative(),
  /** 这道题做得最好的班（一样多就都算） */
  best: z.boolean(),
})

export const classPkProblemSchema = z.object({
  problemId: z.number().int(),
  displayId: z.string(),
  title: z.string(),
  /** 和 `classes` 一一对应；null = 这个班没布置 */
  cells: z.array(classPkCellSchema.nullable()),
})

export const classPkClassSchema = z.object({
  className: z.string(),
  members: z.number().int().nonnegative(),
  /** 这段时间人均做对（这道题第一次做对落在这段时间里） */
  perCapita: z.number(),
  /** 中间那位同学做对几道 */
  median: z.number(),
  solvedMembers: z.number().int().nonnegative(),
  /** 这段时间交过的题里第一次交就对的比例（整数百分比）；一道没交过为 null */
  firstPercent: z.number().int().nonnegative().nullable(),
  /** 同一批题里做得最好（含并列）的有几道 */
  lead: z.number().int().nonnegative(),
  /** 班级对抗里第几；这学期还没做对过题的班没有名次 */
  battleRank: z.number().int().positive().nullable(),
  /** 每个同学这段时间做对几道 */
  distribution: z.array(z.number().int().nonnegative()),
  /** 这学期每周人均新做对，和 `weeks` 一一对应（不随「这周 / 这学期」变） */
  weekly: z.array(z.number()),
})

export const classPkSchema = z.object({
  period: classPkPeriodSchema,
  start: z.string(),
  /** 这学期每周的周一零点（东八区），赛跑和每周人均的横轴 */
  weeks: z.array(z.string()),
  classes: z.array(classPkClassSchema),
  /** 看的人自己的班（学生）；老师和没班级的为 null */
  mine: z.string().nullable(),
  /** 至少两个班布置过的题，按题号 */
  problems: z.array(classPkProblemSchema),
  /** 只有一个班布置过的题：不比，只列出来 */
  solo: z.array(
    z.object({
      problemId: z.number().int(),
      displayId: z.string(),
      title: z.string(),
      className: z.string(),
    }),
  ),
})

export type ClassPkPeriod = z.infer<typeof classPkPeriodSchema>
export type ClassPkCell = z.infer<typeof classPkCellSchema>
export type ClassPkProblem = z.infer<typeof classPkProblemSchema>
export type ClassPkClass = z.infer<typeof classPkClassSchema>
export type ClassPk = z.infer<typeof classPkSchema>
