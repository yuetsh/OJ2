import { z } from 'zod'

import { judgeStatusSchema } from './judge-status'
import { lessonLanguageSchema, lessonModeSchema } from './language'
import { statisticInfoSchema } from './submission'

/** 课堂条上一道题一步的状态（画 / 写），和 myStatus 同一套取值 */
export const lessonStepStatusSchema = z.enum(['accepted', 'tried', 'none'])

/**
 * 老师布置这节课时选的语言（Python / C / C++ / SQL）。null = 没选：推断出来的课、加这一项之前
 * 布置的课。选了之后这份作业「做完」只认这个语言交对的（SQL 题例外，交对 SQL 就算），
 * 学生打开这几道题编辑器默认就是它
 */
export const assignedLanguageSchema = lessonLanguageSchema.nullable()

/**
 * 课堂任务里老师布置这节课的题：按输入顺序给展示题号，最多 20 道，空数组 = 清掉。
 * `language` 是这份作业用什么语言做，null = 没选。
 *
 * 一个班一天可以上几节内容不同的课，每次布置是一行（class_lesson.id）：
 * - `lessonId`：改 / 清掉这一节（任务页上的「改」）；
 * - `newLesson`：今天再开一节（任务页上的「新的一节」）；
 * - 两个都不带：改今天最后布置的那一节，今天还没有就新开 —— 一天只能一份时的老写法，
 *   开着旧页面的老师、没跟上的机房站点发的都是这种，别让它们每改一次就多出一节课
 */
export const classLessonRequestSchema = z.object({
  className: z.string().trim().min(1),
  problemDisplayIds: z.array(z.string().trim().min(1)).max(20),
  language: assignedLanguageSchema.nullable(),
  /** 不带 = 写代码（开着的旧页面发的就是这种）。画流程图时 language 不用，存成 null */
  mode: lessonModeSchema.default('code'),
  lessonId: z.number().int().positive().optional(),
  newLesson: z.boolean().optional(),
})

export const taskBoardProblemSchema = z.object({
  problemId: z.number().int(),
  problemDisplayId: z.string(),
  title: z.string(),
  /** SQL 题不受布置的语言限制：格子数的是 SQL 交的，点进提交列表也按 SQL 筛 */
  isSql: z.boolean(),
  /** 这道题配了挑战（见 problem.ts 的 challengeSchema）：题卡片写挑战成功几人 */
  hasChallenges: z.boolean(),
  /**
   * 这道题今天要做什么：这个班今天布置过的几节里有这道题的，要求合起来（先布置画流程图、再用同样的题
   * 写代码 = both）。格子按它画，和学生那边的「做完」一致。推断出来的课为 null
   */
  mode: lessonModeSchema.nullable(),
})

export const taskBoardCellSchema = z.object({
  /**
   * accepted 看的是题库里（不含比赛）有没有通过过，不限今天 —— 以前做过的也算做完。
   * 布置时选了语言的，代码的次数和通过都只数那个语言（流程图照旧）
   */
  status: z.enum(['accepted', 'tried', 'none']),
  /** 今天在这道题上交了几次（代码 + 流程图） */
  attempts: z.number().int(),
  /**
   * 上面那个数拆开：代码几次、流程图几次。点格子要知道该跳到提交列表的哪一边 ——
   * 这节课整班在画流程图时，跳到代码那边是一片空
   */
  codeAttempts: z.number().int(),
  flowchartAttempts: z.number().int(),
  /**
   * 第一次通过的时刻；今天之前通过的，前端显示成「之前」。先画再写的课是两步都做到的那一刻
   * （晚的那一步）
   */
  acceptedAt: z.string().nullable(),
  /**
   * 代码这一步：交对过（不限今天）/ 交过没对 / 没交过。写代码的课和 status 一样；先画再写的课
   * 要它分出「图画对了、代码还没对」
   */
  codeStatus: lessonStepStatusSchema,
  /**
   * 流程图这一步，只在这节课要画流程图时有（mode 是 flowchart / both），否则 null。
   * - `passedAt`：第一次画到 A / S 的时刻（不限今天）
   * - `latest`：还没画对时最后一张图（不限今天，和 passedAt 同一个范围）：点格子打开它讲哪里画错了，
   *   题卡片下面按走对几组归堆。评分中、评失败的也是它（passed / total 为 null）
   */
  flowchart: z
    .object({
      status: lessonStepStatusSchema,
      passedAt: z.string().nullable(),
      latest: z
        .object({
          id: z.string(),
          /** 0 排队 1 评分中 2 评完 3 评失败（flowchartStatusSchema） */
          status: z.number().int(),
          grade: z.string().nullable(),
          /** 走对几组 / 一共几组；评完之前、2026-10 之前的老评法为 null */
          passed: z.number().int().nullable(),
          total: z.number().int().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  /**
   * 还没做对时，今天最后一次**代码**提交：点格子打开它讲错误，题卡片下面按错法归堆。
   * 做对了、今天没交代码（只画了流程图）的为 null。
   *
   * 只带归类要用的那几样（runtime_error / sample_check 和提交里存的同一份），
   * 不带代码和原始报错 —— 一班四五十人，真要看代码的时候按 submissionId 再拉
   */
  latest: z
    .object({
      submissionId: z.string(),
      result: judgeStatusSchema,
      runtimeError: statisticInfoSchema.shape.runtime_error,
      sampleCheck: statisticInfoSchema.shape.sample_check,
    })
    .nullable(),
  /**
   * 做对了的格子：今天交的每一次代码，从早到晚（范围和 latest 一样）。点格子看他是怎么一次次
   * 做对的，停在哪一次看哪次的代码。没做对的为空 —— 那边点开是讲错误，靠 latest
   */
  trail: z.array(z.object({ id: z.string(), result: judgeStatusSchema, createTime: z.string() })),
  /** 今天第几次代码提交做对的，1 = 一次就对；今天之前就做对了、今天没靠代码做对的为 null */
  acceptedTry: z.number().int().nullable(),
  /**
   * 挑战：done = 做到了这道题的一条挑战（不限今天）；doing = 做对之后今天又交了、还没做到 ——
   * 做完了的学生是在挑战还是闲着，老师一眼看得出。没配挑战的题、没做对的格子为 null
   */
  challenge: z.enum(['done', 'doing']).nullable(),
})

export const taskBoardStudentSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  realName: z.string().nullable(),
  /** 和 problems 同序 */
  cells: z.array(taskBoardCellSchema),
  /** 今天最后一次提交（任何题），没交过为 null */
  lastSubmitAt: z.string().nullable(),
  /**
   * 今天交过**非比赛**的代码 / 画过流程图没有。点名字跳提交列表用：lastSubmitAt 把比赛提交
   * 也算进去了，而提交列表只列非比赛的，只看它会跳到一个空列表
   */
  codeToday: z.boolean(),
  drawnToday: z.boolean(),
  /** 最近几节课（不含今天，个数见 TaskBoard.recentLessons）里交过题的有几节 */
  recentAttended: z.number().int(),
  /**
   * 他此刻开着哪道题的代码编辑器（展示题号），没开着为 null。老师点它就能打开他正在写的
   * 代码，不用等他举手。只认连着**本站**的（和课堂求助一样，在 serve 进程的内存里）
   */
  editing: z.string().nullable(),
  /**
   * 此刻在线（5 分钟内有动静）、今天最后一次上线的时刻（今天没上过线为 null）。
   * 机房两人共用一台电脑时同桌只有一个登着，所以「谁没来」看 seenAt，不看 online。
   * 和 editing 一样只认**本站**：服务器和机房各记各的（在各自的 Redis 里）
   */
  online: z.boolean(),
  seenAt: z.string().nullable(),
})

/**
 * 课堂任务：一个班、今天、这节课的几道题 × 全班学生。「这节课」是今天最后布置的那一节，
 * 今天没布置过就按今天同班的提交推断。
 * className 为 null = 没指定班级、最近两小时也没有哪个班在交（没法猜）。
 */
export const taskBoardSchema = z.object({
  className: z.string().nullable(),
  day: z.string(),
  source: z.enum(['teacher', 'inferred']).nullable(),
  /** 老师布置的这一节的 id（「改」带着它）；推断出来的课为 null */
  lessonId: z.number().int().nullable(),
  /** 这一节布置的语言（见 assignedLanguageSchema） */
  language: assignedLanguageSchema,
  /** 这一节做什么；推断出来的课为 null（代码交对或流程图画对都算） */
  mode: lessonModeSchema.nullable(),
  /** 这一节第一次布置的时刻，之后改题不变；推断出来的课为 null */
  assignedAt: z.string().nullable(),
  /** 第一次布置的老师（真名，没有真名用用户名）；推断出来的课为 null */
  assignedBy: z.string().nullable(),
  /** 这个班最近一次布置选的语言（含今天），给语言下拉当默认值；从没选过为 null */
  lastLanguage: assignedLanguageSchema,
  problems: z.array(taskBoardProblemSchema),
  students: z.array(taskBoardStudentSchema),
  /**
   * 「最近几节课」一共几节（最多 5，不含今天）。一节课 = 这个班同学一起做题的一天
   * （同班同一天 ≥ 5 人做同一道题，和「班里在做」同一个判据）。新班、开学头几周不满 5。
   */
  recentLessons: z.number().int(),
})

/**
 * 提交列表「这节课」那颗按钮要的：哪个班、这节课是哪几道题。和课堂任务同一套取法
 * （老师布置过就用布置的，否则按今天同班提交推断），但不带花名册 —— 列表只拿它当筛选条件。
 * className 为 null = 没指定、最近两小时也没有哪个班在交。
 */
export const classLessonSchema = z.object({
  className: z.string().nullable(),
  source: z.enum(['teacher', 'inferred']).nullable(),
  /**
   * 选了语言时，列表那边连语言一起筛。C / Python 的作业里夹了 SQL 题就是 null：
   * 列表只能筛一种语言，按 C 筛会把 SQL 题交的全藏起来，宁可多列一些
   */
  language: assignedLanguageSchema,
  problems: z.array(z.object({ problemDisplayId: z.string(), title: z.string() })),
})

/**
 * 老师首页「今天的课」：今天在上课的每个班一行（同班 ≥5 人一起交题，或者老师在任务页上布置过）。
 * 题目的人数是今天的（和任务页同一套取法），「全做对」看的是这几道题有没有做对过，不限今天
 */
export const classTodaySchema = z.object({
  classes: z.array(
    z.object({
      className: z.string(),
      source: z.enum(['teacher', 'inferred']).nullable(),
      /** 老师布置的时刻；推断出来的为 null */
      assignedAt: z.string().nullable(),
      /** 布置的老师；推断出来的为 null */
      assignedBy: z.string().nullable(),
      problems: z.array(
        z.object({
          problemDisplayId: z.string(),
          title: z.string(),
          userCount: z.number().int(),
          acceptedCount: z.number().int(),
        }),
      ),
      /** 今天交过题的人数 / 全班人数 */
      activeCount: z.number().int(),
      rosterCount: z.number().int(),
      /** 这节课的题全做对了的人数 */
      allDoneCount: z.number().int(),
      /** 今天最后一次有人交题；还没人交（只布置了）为 null */
      lastSubmitAt: z.string().nullable(),
    }),
  ),
})

/**
 * 课上老师在任务页（或后台）改了**今天这节**布置的题，推给这个班还开着页面的学生：告诉他们改了哪些，
 * 点「刷新」重新载入。只有学生看到的那一节（今天最后布置的）变了才推 —— 改的是今天早些时候的一节、
 * 或者改完和原来一样，都不推。走 /ws/config 那条全局常驻的连接。
 *
 * - `assigned`：今天这节是新布置的（原来没布置，或者「新的一节」），`problems` 是整张单子
 * - `changed`：同一节改了，看 `added` / `removed` / `languageChanged` / `reordered`
 * - `cleared`：清掉了，学生那边退回按同班提交推断
 */
export const lessonUpdateProblemSchema = z.object({ problemDisplayId: z.string(), title: z.string() })

export const lessonUpdateSchema = z.object({
  type: z.literal('lesson_update'),
  kind: z.enum(['assigned', 'changed', 'cleared']),
  language: assignedLanguageSchema,
  /** 清掉了为 null。languageChanged 连它一起算：改成画流程图、改成先画再写也是「做法变了」 */
  mode: lessonModeSchema.nullable(),
  problems: z.array(lessonUpdateProblemSchema),
  added: z.array(lessonUpdateProblemSchema),
  removed: z.array(lessonUpdateProblemSchema),
  languageChanged: z.boolean(),
  reordered: z.boolean(),
})

export type LessonUpdate = z.infer<typeof lessonUpdateSchema>

export type ClassToday = z.infer<typeof classTodaySchema>
export type ClassLessonRequest = z.input<typeof classLessonRequestSchema>
export type TaskBoard = z.infer<typeof taskBoardSchema>
export type ClassLesson = z.infer<typeof classLessonSchema>
export type TaskBoardProblem = z.infer<typeof taskBoardProblemSchema>
export type TaskBoardStudent = z.infer<typeof taskBoardStudentSchema>
export type TaskBoardCell = z.infer<typeof taskBoardCellSchema>

/**
 * 后台「课堂任务」：布置过的每一节课一行（class_lesson），新的在前。任务页上当场布置的、
 * 后台补的都在这里，数据统计按它们切课。
 */
export const adminLessonSchema = z.object({
  id: z.number().int(),
  className: z.string(),
  /** 东八区的日子，`2026-10-08` */
  day: z.string(),
  /** 布置的时刻（任务页上第一次布置那一刻；后台补的是填的时刻） */
  createdAt: z.string(),
  updatedAt: z.string(),
  /** 布置的老师：真名，没有真名用用户名（和任务页「谁 布置」一样） */
  createdBy: z.string(),
  language: assignedLanguageSchema,
  mode: lessonModeSchema,
  /** 按布置的顺序；题后来被藏起来的 visible 为 false（统计、学生那边都不再出现） */
  problems: z.array(z.object({ problemDisplayId: z.string(), title: z.string(), visible: z.boolean() })),
  /** 班里的学生数（STUDENT_ROLES、没禁用），和 doneCount 同一个花名册 */
  classSize: z.number().int(),
  /** 把布置的题全做对了的人数（那天结束前；口径同任务页） */
  doneCount: z.number().int(),
})

export const adminLessonListSchema = z.object({
  results: z.array(adminLessonSchema),
  total: z.number().int().nonnegative(),
  /** 布置过课的老师（筛选下拉用），按布置的节数从多到少 */
  teachers: z.array(z.object({ id: z.number().int(), name: z.string() })),
})

/**
 * 后台新补一节 / 改一节。日子和时刻按东八区填：补的是任务页外上的课（没在任务页布置、
 * 以前的课），时刻决定同一天几节课的先后。题目至少一道 —— 删掉一节走 DELETE
 */
export const adminLessonRequestSchema = z.object({
  className: z.string().trim().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  language: assignedLanguageSchema,
  mode: lessonModeSchema.default('code'),
  problemDisplayIds: z.array(z.string().trim().min(1)).min(1).max(20),
})
export type AdminLesson = z.infer<typeof adminLessonSchema>
export type AdminLessonList = z.infer<typeof adminLessonListSchema>
export type AdminLessonRequest = z.infer<typeof adminLessonRequestSchema>
