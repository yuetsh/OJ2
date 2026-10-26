import { FLOWCHART_PASS_GRADES, STUDENT_ROLES, type LessonLanguage } from '@oj2/contract'
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import { db, schema } from '../db'
import { JudgeStatus } from '../judge/status'

/**
 * 课堂上「谁做了哪道题」的取数口径：课堂条、看板、自学情况、后台首页「正在上课的班」
 * 都从这里数。原来写在 routes/classroom.ts 里，后台 conf.ts 要猜正在上课的班，
 * 就只能从另一个路由文件里 import —— 挪到 services 来，两边都从这里拿。
 */
/** AST_CHECK_FAILED 也是答案对了，与周榜同口径 */
export const SOLVED_RESULTS = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

/**
 * 流程图画到 A / S 算这道题做完（设计文档 2026-09-28-problem-page-redesign 第 3 节决定 6）。
 * 等级由分数推出（flowchart/grade.ts），重新评分会先把 grade 清空，所以 status = 2 其实
 * 是冗余的，留着是把「评完了」写明。
 */
export const FLOWCHART_PASSED = and(eq(schema.flowchartSubmission.status, 2), inArray(schema.flowchartSubmission.aiGrade, [...FLOWCHART_PASS_GRADES]))!

/** 这个班正常状态的学生，给下面的查询当 `user_id in (...)` 用 */
export function classMemberIds(className: string) {
  return db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(eq(schema.user.className, className), eq(schema.user.isDisabled, false), inArray(schema.user.adminType, [...STUDENT_ROLES])))
}

/**
 * 做题记录：代码提交（不含比赛）和流程图提交并成一张，一次提交一行。课堂上的统计
 * （这节课是哪几道题、班上几人做完、最近几节课来了几次、哪个班在上课）都从这里数，
 * 口径和课堂条 / 看板的「做完」一致：
 *
 * - 交过就算「动过手」：代码提交不论结果，流程图不论评没评完、评没评失败；
 * - `solved`：代码 AC / AST_CHECK_FAILED，流程图评到 A / S。
 *
 * 有的题一节课全班都在画流程图、代码提交个位数，只数代码的话这节课在统计里等于没上。
 * 两边都按 `user_id in (...)` + `create_time >=` 走各自的 (user_id, create_time) 索引。
 */
/**
 * 老师布置时选了语言：代码只数这个语言交的。SQL 题例外 —— 它只收 SQL，按 C 去数的话，
 * C 的作业里夹一道 SQL 题，学生怎么交都算不了做完。非 SQL 题交不进 SQL（提交接口按题目的
 * 语言拦），所以一律放行 SQL 不会把别的题算宽
 */
export function lessonLanguageFilter(language: LessonLanguage | null | undefined) {
  return language ? inArray(schema.submission.language, [language, 'SQL']) : undefined
}

export function activityRows(options: {
  since: string
  users?: number[] | ReturnType<typeof classMemberIds>
  problemIds?: number[]
  /** 老师布置时选了语言：代码只数这个语言交的（见 lessonLanguageFilter），流程图不受影响 */
  language?: LessonLanguage | null
}) {
  const { since, users, problemIds, language } = options
  const code = db
    .select({
      userId: schema.submission.userId,
      problemId: schema.submission.problemId,
      createTime: schema.submission.createTime,
      solved: sql<boolean>`${inArray(schema.submission.result, SOLVED_RESULTS)}`.as('solved'),
    })
    .from(schema.submission)
    .where(
      and(
        isNull(schema.submission.contestId),
        gte(schema.submission.createTime, since),
        users ? inArray(schema.submission.userId, users) : undefined,
        problemIds ? inArray(schema.submission.problemId, problemIds) : undefined,
        lessonLanguageFilter(language),
      ),
    )
  const flowchart = db
    .select({
      userId: schema.flowchartSubmission.userId,
      problemId: schema.flowchartSubmission.problemId,
      createTime: schema.flowchartSubmission.createTime,
      solved: sql<boolean>`${FLOWCHART_PASSED}`.as('solved'),
    })
    .from(schema.flowchartSubmission)
    .where(
      and(
        gte(schema.flowchartSubmission.createTime, since),
        users ? inArray(schema.flowchartSubmission.userId, users) : undefined,
        problemIds ? inArray(schema.flowchartSubmission.problemId, problemIds) : undefined,
      ),
    )
  return code.unionAll(flowchart).as('activity')
}

/** 看板没指定班级时，猜「最近这么久里提交人数最多的班」—— 老师多半正在上这个班的课 */
const ACTIVE_CLASS_WINDOW_MS = 2 * 60 * 60 * 1000

/**
 * 从实际提交猜正在上课的班，而**不是记住老师上次选的**：统计面板吃过那个亏（上一节课
 * 的班悄悄留在框里，老师看的整个是别人的班）。
 */
export async function suggestActiveClass() {
  // 流程图也算：一节课全班都在画流程图时，只数代码提交就猜成了别的班
  const activity = activityRows({
    since: new Date(Date.now() - ACTIVE_CLASS_WINDOW_MS).toISOString(),
  })
  const users = sql<number>`count(distinct ${activity.userId})::int`
  const [row] = await db
    .select({ className: schema.user.className, users })
    .from(activity)
    .innerJoin(schema.user, eq(schema.user.id, activity.userId))
    .where(and(isNotNull(schema.user.className), eq(schema.user.isDisabled, false), inArray(schema.user.adminType, [...STUDENT_ROLES])))
    .groupBy(schema.user.className)
    .orderBy(desc(users))
    .limit(1)
  return row?.className ?? null
}
