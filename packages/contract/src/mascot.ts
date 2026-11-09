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
 * - `play`：被摆弄（action 记 `fling` 甩出去 / `shake` 拎着摇晕 / `tickle` 鼠标蹭着挠痒，line 是她说的那句）
 * - `answer`：回答了她闲聊时问的问题（situation = `ask.<题>`，action = 选的那一项的键，line 是她接的那句）
 * - `feed`：喂了她一条小鱼干（line 是她说的那句）。小鱼干做对新题攒，喂一条记一条，剩几条按这个算（见 mascotProfileSchema.fish）
 *
 * 另外两种不是对她做的，是她要看的行为，别处没有存：
 * - `trial`：在题目页运行了例子 / 自己输入（action 记 `samples` / `custom`）
 * - `help`：在题目页举了手
 *
 * `open` / `speak` / `pat` / `overclick` / `play` / `feed` 的 line 合起来就是她对这个学生说过的话（GET /mascot/journal，主页的台词收集）。
 *
 * 不记代码、不记按键。
 */
export const MASCOT_EVENT_KINDS = ['open', 'action', 'speak', 'pat', 'overclick', 'move', 'play', 'answer', 'feed', 'trial', 'help'] as const
/** 这几种的 line 是她说出口的话，算进台词收集 */
export const MASCOT_SPOKEN_KINDS = ['open', 'speak', 'pat', 'overclick', 'play', 'feed'] as const satisfies readonly (typeof MASCOT_EVENT_KINDS)[number][]
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

/** 小鱼干上线时每人先送几条：没做新题也能先喂着试试 */
export const MASCOT_FISH_GIFT = 3
/** 从这一天（东八区）起第一次做对的题才攒小鱼干，以前做对的不算 */
export const MASCOT_FISH_SINCE = '2026-11-09'

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
  /**
   * 小鱼干：上线时每人先送 MASCOT_FISH_GIFT 条，之后每做对一道**新**题（第一次做对的时刻在 MASCOT_FISH_SINCE 之后，
   * 含比赛题）攒一条。剩几条 = 送的 + earned - fed，前台算
   */
  fish: z.object({
    earned: z.number().int(),
    fed: z.number().int(),
  }),
  /** 闲聊时问过的问题，每题最后一次选的是哪一项（`ask.<题>` 去掉前缀 → 选项的键） */
  answers: z.record(z.string(), z.string()),
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

/**
 * 和她的相处记录（GET /mascot/journal），主页「小鲸鱼」那张卡和点开的那一页用。只给本人看。
 *
 * `lines` 是她对这个学生说过的话（上面 MASCOT_SPOKEN_KINDS 的 line），去重，最近说的在前。
 * 记下来的是填好数的那一句（「还差 3 道」），前台和台词表对的时候把 `{n}` 当通配。
 */
export const mascotJournalSchema = z.object({
  /** 第一次碰她的时刻，从没碰过是 null */
  firstAt: z.string().nullable(),
  /** 有几天（东八区日历日）碰过她 */
  days: z.number().int(),
  /** 各种互动的次数 */
  counts: z.object({
    /** 点开她说话 */
    opens: z.number().int(),
    /** 点了气泡里的按钮 */
    actions: z.number().int(),
    /** 摸头 */
    pats: z.number().int(),
    /** 惹到她背过身去 */
    sulks: z.number().int(),
    /** 拖着她挪地方 */
    moves: z.number().int(),
    /** 藏到屏幕边上 */
    peeks: z.number().int(),
    /** 甩出去 */
    flings: z.number().int(),
    /** 拎着摇晕 */
    shakes: z.number().int(),
    /** 喂小鱼干 */
    feeds: z.number().int(),
    /** 挠痒 */
    tickles: z.number().int(),
    /** 她主动跟你说话 */
    spoken: z.number().int(),
  }),
  /** 一天里各个钟点（东八区 0～23 点）碰她的次数，24 个 */
  byHour: z.array(z.number().int()),
  /** 最常在哪一页碰她（路由路径的第一段，比如 `problem`），没有就是 null */
  favoritePage: z.string().nullable(),
  lines: z.array(z.string()),
})
export type MascotJournal = z.infer<typeof mascotJournalSchema>
