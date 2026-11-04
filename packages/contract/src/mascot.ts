import { z } from 'zod'

/**
 * 看板娘的互动记录（POST /mascot/events）。前台每次互动发一条，落进 `mascot_event`：
 *
 * - `open`：点她冒出气泡（situation = 她当时判断的情况，line = 说的那句）
 * - `action`：点了气泡里的按钮（action = 按钮上的字）
 * - `speak`：她主动开口（situation / line 同 open）
 * - `pat`：连点触发了摸头彩蛋
 * - `overclick`：连点到她嫌烦
 * - `move`：被拖到了别处（line 记落点贴的边，比如 `right bottom`）
 *
 * 另外两种不是对她做的，是她要看的行为，别处没有存：
 * - `trial`：在题目页运行了例子 / 自己输入（action 记 `samples` / `custom`）
 * - `help`：在题目页举了手
 *
 * 不记代码、不记按键。
 */
export const MASCOT_EVENT_KINDS = ['open', 'action', 'speak', 'pat', 'overclick', 'move', 'trial', 'help'] as const
export const mascotEventKindSchema = z.enum(MASCOT_EVENT_KINDS)
export type MascotEventKind = z.infer<typeof mascotEventKindSchema>

export const mascotEventSchema = z.object({
  kind: mascotEventKindSchema,
  situation: z.string().max(64).optional(),
  line: z.string().max(100).optional(),
  action: z.string().max(32).optional(),
  /** 当时在哪一页（路由路径，不带查询串） */
  path: z.string().max(200),
})
export type MascotEventInput = z.infer<typeof mascotEventSchema>

/**
 * 看板娘按学生的行为挑话用的（GET /mascot/profile）。只给学生自己的，进页面时拉一次。
 *
 * `recent` 是最近 20 次题库提交（不含比赛）里各类错误的次数；`runtimeErrorType` 是其中
 * 运行出错最多的那一种（NameError、TypeError …，C/C++ 没有这一项），没有就是 null。
 */
export const mascotProfileSchema = z.object({
  /** 一共点开过她几次（open 事件数），按账号算 */
  pokes: z.number().int(),
  /**
   * 一共做对了几道不同的题，含比赛题（就是成就的 accepted_count，user_stat 里存着的那个数）。
   * 看板娘的好感按它分档，点她多少次不算
   */
  solved: z.number().int(),
  /** 今天（东八区）做对了几道不同的题 */
  todaySolved: z.number().int(),
  /** 一共点过几次「太难了」（做对后的点评） */
  tooHard: z.number().int(),
  /** 这一周（东八区周一零点起）：题库里交了几次、跑了几次例子、举了几次手、要了几次 AI 提示 */
  week: z.object({
    submits: z.number().int(),
    trials: z.number().int(),
    helps: z.number().int(),
    aiHints: z.number().int(),
  }),
  /**
   * 跨天记得的事。「几天前」是东八区日历日之差，只看 7 天内、今天以前的；
   * 那件事之后已经说过对应那句（situation = memory.grudge / memory.pat）就是 null，同一件事只翻一次旧账
   */
  memory: z.object({
    /** 最近一次被点到背过身（situation = sulk 的那次点开）是几天前 */
    grudgeDaysAgo: z.number().int().nullable(),
    /** 最近一次被摸头是几天前 */
    patDaysAgo: z.number().int().nullable(),
    /** 今天以前做对了几道（和 solved 同一个口径）：和 solved 一比就知道今天升没升好感档 */
    solvedBeforeToday: z.number().int(),
    /** 今天说过「熟了一点」（memory.closer）没有 */
    closerSaidToday: z.boolean(),
  }),
  recent: z.object({
    total: z.number().int(),
    wrongAnswer: z.number().int(),
    compileError: z.number().int(),
    runtimeError: z.number().int(),
    timeout: z.number().int(),
    runtimeErrorType: z.string().nullable(),
  }),
})
export type MascotProfile = z.infer<typeof mascotProfileSchema>
