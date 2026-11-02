import { z } from 'zod'

import { judgeStatusSchema } from './judge-status'
import { lessonModeSchema } from './language'
import { assignedLanguageSchema, lessonStepStatusSchema } from './task'

/**
 * 「班里在做」：同班同一天有好几个人做的题，基本就是老师在课上点名的那几道。
 * `day` 是东八区日历日；最近 7 天都没有这样的题时为 null，`problems` 为空。
 */
export const classActivityProblemSchema = z.object({
  problemDisplayId: z.string(),
  title: z.string(),
  /** 那天做过这道题的同班人数（含自己） */
  userCount: z.number().int(),
  /** 其中那天通过了的人数 */
  acceptedCount: z.number().int(),
  /**
   * 我自己在题库里（不含比赛）做这道题的状态，不限那一天。老师布置时选了语言的，
   * 代码只认用那个语言交的（流程图照旧算）
   */
  myStatus: z.enum(['accepted', 'tried', 'none']),
  /**
   * 今天布置的课要这道题画流程图 / 写代码时，这一步我做到哪了；不要这一步为 null。
   * 推断出来的课两个都是 null（不分步，myStatus 照旧代码或流程图做对都算）。
   *
   * 一道题今天可能被布置了两次（先布置画流程图、再布置写代码）：两节课的要求合起来算，
   * 学生那边就和「先画再写」一样是两步 —— 老师开了写代码的那节，还没画完的人照样看得到要画
   */
  draw: lessonStepStatusSchema.nullable(),
  code: lessonStepStatusSchema.nullable(),
})

export const classActivitySchema = z.object({
  className: z.string().nullable(),
  day: z.string().nullable(),
  /** teacher = 老师在课堂任务里布置的；inferred = 从同班提交记录推断的 */
  source: z.enum(['teacher', 'inferred']).nullable(),
  /** 写代码那一步用的语言：今天最后布置的、要写代码的那节选的（只画流程图的课为 null） */
  language: assignedLanguageSchema,
  /** 今天最后布置的那节做什么；推断出来的课为 null */
  mode: lessonModeSchema.nullable(),
  problems: z.array(classActivityProblemSchema),
})

/**
 * 首页的「上次来」卡（原来登录后弹的「登录速报」并进了首页，AI 那两句不要了）。
 * 窗口是**上次登录到这次登录之间**，不是到现在 —— 这次登录期间卡片内容不变，
 * 今天做的题不会混进「上次」里。只算题库提交，比赛的题号在题库里点不开。
 */
export const lastVisitSchema = z.object({
  /** 上次登录的时刻。null = 头一回登录（或会话早于这个字段） */
  previousLogin: z.string().nullable(),
  /** null = 上次来已经是 30 天以前，或那次一条代码都没交 */
  summary: z
    .object({
      submissionCount: z.number().int(),
      /** 那次做对的题数（去重） */
      solvedCount: z.number().int(),
      /** 那次最后一条提交的时刻，前端拿它和「班里那天」比是不是同一天 */
      lastSubmitTime: z.string(),
      /**
       * 那次交过、**到现在都还没做对**的题（这次登录后补做对了的不算），
       * 按最后一次提交倒序，最多 3 道
       */
      unsolved: z.array(
        z.object({
          problemDisplayId: z.string(),
          title: z.string(),
          attempts: z.number().int(),
          lastResult: judgeStatusSchema,
        }),
      ),
      /** 那次做对的题，按第一次做对的先后，最多 12 道（总数看 solvedCount） */
      solved: z.array(z.object({ problemDisplayId: z.string(), title: z.string() })),
    })
    .nullable(),
})

export type ClassActivity = z.infer<typeof classActivitySchema>
export type LastVisit = z.infer<typeof lastVisitSchema>
export type ClassActivityProblem = z.infer<typeof classActivityProblemSchema>
