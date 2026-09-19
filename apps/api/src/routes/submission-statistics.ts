/**
 * 教师统计：今日提交分布、按学生/题目的统计面板、展开行的提交明细。
 *
 * 从 submission.ts 拆出来的一整块。**挂载位置不能动**：submission.ts 在原位置
 * `route("/", submissionStatisticsRoutes)`，必须排在 `/submissions/:id` 之前，
 * 否则 `/submissions/statistics` 会被当成 id 吞掉（Hono 按注册顺序匹配）。
 */

import {
  type SubmissionStatistics,
  type SubmissionStatisticsItems,
  type TodaySubmissionStatistics,
} from "@oj2/contract"
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireTeacher } from "../auth/middleware"
import type { AuthUser } from "../auth/session"
import { db, schema } from "../db"
import { failure, success } from "../http"
import {
  JudgeStatus,
  UNJUDGED_RESULTS,
  type JudgeStatusValue,
} from "../judge/status"
import { type ContestEnv } from "../services/contest"
import { getBooleanOption } from "../services/options"
import { localTime, todayStart } from "../time"
import { isAdminRole, matchedUsers, rounded, stripClassPrefix } from "./helpers"

export const submissionStatisticsRoutes = new Hono<ContestEnv>()

const ACCEPTED_RESULTS = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

/** 正确率。分母是判完的条数，一条都还没判完时给 0 而不是 NaN */
function judgedRate(accepted: number, judged: number) {
  return judged > 0 ? rounded((accepted / judged) * 100) : 0
}

/**
 * 「今日提交数」标签点开的统计。**公开、只出聚合数**（没有用户名、没有代码，
 * 热门题只算公开可见的题），口径和那颗标签一致：东八区今天 + 非比赛提交。
 *
 * 按钟点切用 `localTime()`，不能写 `extract(hour from create_time)` ——
 * 后者按数据库会话时区算，容器是 UTC，整张分布图会整体左移 8 小时。
 */
submissionStatisticsRoutes.get(
  "/submissions/today-statistics",
  optionalAuth,
  async (c) => {
    /**
     * 「提交列表对学生全开」关掉时（考试那种场合）不给热门题这张表 —— 总数、正确率
     * 这些聚合数原本就从公开的 today-count 看得出来，但「哪几道题在被刷」已经贴近
     * 提交列表本身的内容了，得跟着同一个开关走。数字照给，不然标签说 21、弹框说 0。
     */
    const showProblems =
      (await getBooleanOption("submission_list_show_all", true)) ||
      isAdminRole(c.get("user"))
    const where = and(
      isNull(schema.submission.contestId),
      sql`${schema.submission.createTime} >= ${todayStart()}`,
    )
    const acceptedFilter = sql`count(*) filter (where ${inArray(schema.submission.result, ACCEPTED_RESULTS)})`
    const judgingFilter = sql`count(*) filter (where ${inArray(schema.submission.result, UNJUDGED_RESULTS)})`
    const hour = sql<number>`extract(hour from ${localTime(schema.submission.createTime)})::int`

    const [[totals], hourRows, languageRows, resultRows, problemRows] =
      await Promise.all([
        db
          .select({
            total: count(),
            accepted: acceptedFilter.mapWith(Number),
            judging: judgingFilter.mapWith(Number),
            userCount:
              sql<number>`count(distinct ${schema.submission.userId})`.mapWith(
                Number,
              ),
          })
          .from(schema.submission)
          .where(where),
        db
          .select({ hour, value: count() })
          .from(schema.submission)
          .where(where)
          .groupBy(hour),
        db
          .select({ language: schema.submission.language, value: count() })
          .from(schema.submission)
          .where(where)
          .groupBy(schema.submission.language)
          .orderBy(desc(count())),
        db
          .select({ result: schema.submission.result, value: count() })
          .from(schema.submission)
          .where(where)
          .groupBy(schema.submission.result)
          .orderBy(desc(count())),
        showProblems
          ? db
              .select({
                displayId: schema.problem.displayId,
                title: schema.problem.title,
                value: count(),
                accepted: acceptedFilter.mapWith(Number),
              })
              .from(schema.submission)
              .innerJoin(
                schema.problem,
                eq(schema.problem.id, schema.submission.problemId),
              )
              // 隐藏题目不出现在这张表里：接口不需要登录，标题本身就是不该外露的东西
              .where(and(where, eq(schema.problem.visible, true)))
              .groupBy(
                schema.problem.id,
                schema.problem.displayId,
                schema.problem.title,
              )
              .orderBy(desc(count()))
              .limit(10)
          : [],
      ])

    const total = totals?.total ?? 0
    const judging = totals?.judging ?? 0
    const hours = Array.from({ length: 24 }, () => 0)
    for (const row of hourRows) hours[row.hour] = row.value

    return success(c, {
      total,
      accepted: totals?.accepted ?? 0,
      judging,
      correctRate: judgedRate(totals?.accepted ?? 0, total - judging),
      userCount: totals?.userCount ?? 0,
      hours,
      languages: languageRows.map((row) => ({
        language: row.language,
        count: row.value,
      })),
      results: resultRows.map((row) => ({
        result: row.result,
        count: row.value,
      })),
      problems: problemRows.map((row) => ({
        problem: row.displayId,
        problemTitle: row.title,
        count: row.value,
        acceptedCount: row.accepted,
      })),
    } satisfies TodaySubmissionStatistics)
  },
)

/**
 * 统计接口共用的时间窗解析。旧后端 `end` 必填、`start` 可选（不给就是「全部时段」）。
 */
function statisticsRange(c: {
  req: { query(name: string): string | undefined }
}) {
  const end = c.req.query("end")?.trim()
  if (!end) return null
  const start = c.req.query("start")?.trim()
  return { start: start || null, end }
}

/** 一次最多查几道题。课堂上一节课布置三五道，20 是留足了余量的上限 */
const STATISTICS_MAX_PROBLEMS = 20

/**
 * 题号框允许一次填几道：`1001,1005,1010`。中英文逗号、空格、分号都当分隔符 ——
 * 老师在投影前手敲，不该因为打了个全角逗号就查不出来。
 */
function parseDisplayIds(raw: string) {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const part of raw.split(/[,，;；\s]+/)) {
    const id = part.trim()
    if (!id) continue
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(id)
  }
  return ids
}

/**
 * 按题号（展示用的 _id）定位公开题目。**有一个找不到就整体报错**，不退化成「全部题目」——
 * 否则教师打错一个字就会看到全站数据还以为是这几道题的。
 */
async function findPublicProblemsByDisplayIds(displayIds: string[]) {
  const lowered = displayIds.map((id) => id.toLowerCase())
  const rows = await db
    .select({ id: schema.problem.id, displayId: schema.problem.displayId })
    .from(schema.problem)
    .where(
      and(
        inArray(sql`lower(${schema.problem.displayId})`, lowered),
        isNull(schema.problem.contestId),
        eq(schema.problem.visible, true),
      ),
    )
  const found = new Set(rows.map((row) => row.displayId.toLowerCase()))
  const missing = displayIds.find((id) => !found.has(id.toLowerCase()))
  return { ids: rows.map((row) => row.id), missing: missing ?? null }
}

/**
 * 展开行一次只看一个人（表格的 updateExpandedRowKeys 只留最后一个 key），所以明细
 * **按需拉**，不再随统计一起下发。
 *
 * 原来是随 data 一起给所有人各带一份：生产快照实测，「全部时段 + 不填条件」要搬
 * 49108 行（最早那版不截断是 105631 行），而其中真正被人看到的最多一个人的那几十条。
 */
const STATISTICS_ITEMS_LIMIT = 200

/** 错误摘要截断长度。编译错误能刷几十行，弹层里放不下，也没必要 */
const FAILURE_MESSAGE_LIMIT = 400

/**
 * 「交了没对」那一栏点开要看的：这个人**最近一条**提交错在哪。
 *
 * 有了它，老师看到「张三 12次」之后不用再切到提交列表、翻到这个人、点开代码 ——
 * 点一下名字就知道是编译错了还是答案错了、报的什么。err_info 是判题机塞进
 * statistic_info 的那一段，提交详情页读的也是它。
 */
async function lastFailureByUser(where: SQL | undefined, userIds: number[]) {
  // result 手写成 JudgeStatusValue：这条裸 SQL 读的就是 submission.result 那一列，
  // 口径要和列上的 $type 一致
  const byUser = new Map<
    number,
    {
      id: string
      problem: string
      result: JudgeStatusValue
      error: string | null
    }
  >()
  if (!userIds.length) return byUser

  // 不给 submission 起别名：where 里的条件是 drizzle 拼的，引用的是 "submission"."x"
  const rows = await db.execute<{
    user_id: number
    id: string
    problem: string
    result: JudgeStatusValue
    error: string | null
  }>(sql`
    select user_id, id, problem, result, error from (
      select
        ${schema.submission.userId} as user_id,
        ${schema.submission.id} as id,
        ${schema.problem.displayId} as problem,
        ${schema.submission.result} as result,
        left(${schema.submission.statisticInfo}->>'err_info', ${FAILURE_MESSAGE_LIMIT}) as error,
        row_number() over (
          partition by ${schema.submission.userId}
          order by ${schema.submission.createTime} desc
        ) as rn
      from ${schema.submission}
      join ${schema.problem} on ${schema.problem.id} = ${schema.submission.problemId}
      where ${and(where, inArray(schema.submission.userId, userIds))}
    ) t
    where rn = 1
  `)

  for (const row of rows) {
    byUser.set(row.user_id, {
      id: row.id,
      problem: row.problem,
      result: row.result,
      error: row.error,
    })
  }
  return byUser
}

/**
 * 「答案对了，但没按要求的语法写」的题数（AST_CHECK_FAILED）。
 *
 * 只算**最后也没改对**的：同一道题上既有 AST_CHECK_FAILED 又有 ACCEPTED，说明学生后来
 * 改成要求的写法了，不该再拿这个提醒老师。所以要先按「人 × 题」聚一层，不能直接
 * `count(distinct problem_id) filter (result = 10)`。
 *
 * 口径本身不动 —— AST_CHECK_FAILED 仍然算通过（答案确实对了，全站一致）。这里只是
 * 让教师看得见「这几个人是绕过要求做出来的」，教学上那不算达标。
 */
async function astOnlyByUser(where: SQL | undefined, userIds: number[]) {
  const byUser = new Map<number, number>()
  if (!userIds.length) return byUser

  const rows = await db.execute<{ user_id: number; n: number }>(sql`
    select user_id, count(*)::int as n from (
      select
        ${schema.submission.userId} as user_id,
        bool_or(${schema.submission.result} = ${JudgeStatus.AST_CHECK_FAILED}) as has_ast,
        bool_or(${schema.submission.result} = ${JudgeStatus.ACCEPTED}) as has_ac
      from ${schema.submission}
      where ${and(where, inArray(schema.submission.userId, userIds))}
      group by ${schema.submission.userId}, ${schema.submission.problemId}
    ) t
    where has_ast and not has_ac
    group by user_id
  `)
  for (const row of rows) byUser.set(row.user_id, row.n)
  return byUser
}

/**
 * 两条提交列表的用户名筛选。**两边都要匹配**：
 *
 * - `user_id in (改过名的当前用户名匹配到的账号)` —— 老师用现在的班级前缀查
 *   `ks248`，要能查出这个人改名之前交的那些（生产快照：比赛提交里有 685 条
 *   挂在旧名字下）；
 * - `submission.username ilike` —— 已删号的学生在 `user` 表里没有行，只剩提交里
 *   冻结的那份名字；顺带也让「按记得的旧名字查」还查得到。
 *
 * 统计接口那边只按 user_id 筛（口径是「花名册上这个班谁做完了」，已删号的人本来
 * 就不在花名册里）；这两条是公开列表，不该因为改名或删号少给记录，所以取并集。
 *
 * 账号那一支**先查出 id 再拼成字面列表**，不写成 `user_id in (子查询)`：子查询夹在 OR
 * 里会被做成 hashed SubPlan，整条 OR 就不可索引，加了 trigram 索引照样全表扫。拆开之后
 * 两支各走各的索引（submission_public_metrics_idx + submission_public_username_trgm_idx），
 * 快照实测 count 65ms → 0.6ms。`ks2` 这种匹配上千个账号的宽前缀退回扫表，30~50ms，
 * 和原来持平。
 */
export async function usernameFilter(username: string) {
  const like = `%${username}%`
  const users = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(ilike(schema.user.username, like))
  const frozen = ilike(schema.submission.username, like)
  return users.length
    ? or(
        inArray(
          schema.submission.userId,
          users.map((row) => row.id),
        ),
        frozen,
      )!
    : frozen
}

/**
 * 两条提交列表的题号筛选：先把题号解析成 problem.id，再按 `submission.problem_id` 筛。
 * 原来是 join problem 之后比 `lower(problem._id)`，条件落在 problem 表上，规划器只能
 * 顺着时间索引倒扫、逐行回表比对，走不上 submission_public_problem_time_idx。
 *
 * 公开列表只认公开题、比赛列表只认本场的题：题号只在这个范围内唯一（比赛题的 `_id`
 * 和公开题撞号是常态），而公开提交从不指向比赛题（快照核过，0 条）。
 * 查无此题时留恒假条件，少推一个 filter 就成了「不筛」。
 */
export async function problemFilter(
  displayId: string,
  contestId: number | null,
) {
  const problems = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(
      and(
        sql`lower(${schema.problem.displayId}) = lower(${displayId})`,
        contestId === null
          ? isNull(schema.problem.contestId)
          : eq(schema.problem.contestId, contestId),
      ),
    )
  return problems.length
    ? inArray(
        schema.submission.problemId,
        problems.map((row) => row.id),
      )
    : sql`false`
}

/**
 * 两个统计接口共用的范围：时间窗 + 题号。**用户名不在里面** —— 统计那边是
 * ilike 模糊匹配（填 ks251 要匹配整个班），明细那边必须精确到人，口径不同。
 * 两边都是先拿用户名去 `user` 表解析成 user_id，再按 user_id 筛提交。
 */
type StatisticsScope =
  | { ok: true; filters: SQL[]; problemCount: number }
  | { ok: false; status: 400 | 404; code: string; message: string }

async function statisticsScope(c: {
  req: { query(name: string): string | undefined }
}): Promise<StatisticsScope> {
  const range = statisticsRange(c)
  if (!range) {
    return {
      ok: false,
      status: 400,
      code: "invalid-request",
      message: "end is required",
    }
  }

  const filters = [
    isNull(schema.submission.contestId),
    sql`${schema.submission.createTime} <= ${range.end}`,
  ]
  if (range.start)
    filters.push(sql`${schema.submission.createTime} >= ${range.start}`)

  const displayIds = parseDisplayIds(c.req.query("problemId") ?? "")
  if (displayIds.length > STATISTICS_MAX_PROBLEMS) {
    return {
      ok: false,
      status: 400,
      code: "invalid-request",
      message: `At most ${STATISTICS_MAX_PROBLEMS} problems`,
    }
  }
  if (displayIds.length) {
    const { ids, missing } = await findPublicProblemsByDisplayIds(displayIds)
    if (missing) {
      return {
        ok: false,
        status: 404,
        code: "problem-not-found",
        message: `Problem ${missing} does not exist`,
      }
    }
    filters.push(inArray(schema.submission.problemId, ids))
  }

  return { ok: true, filters, problemCount: displayIds.length }
}

submissionStatisticsRoutes.get(
  "/submissions/statistics",
  requireTeacher,
  async (c) => {
    const scope = await statisticsScope(c)
    if (!scope.ok) return failure(c, scope.status, scope.code, scope.message)
    const filters = scope.filters

    const username = c.req.query("username")?.trim()
    // 用户名先解析成账号，再拿 user_id 去筛提交。这一趟查询挡在 Promise.all 前面，
    // 但换掉的是下面**四条**语句各一次的 submission 全表扫：`ilike` 走不了索引，
    // 换成 `user_id in (...)` 之后四条全走索引（生产快照实测单条 18448 → 537
    // buffers；同一个快照上整个接口查一个班 120~250ms → 10ms 上下），多这一次往返是赚的。
    const matched = username ? await matchedUsers(username) : []
    if (username) {
      const matchedIds = matched.map((row) => row.id)
      // 一个账号都没匹配上时得留个恒假条件。少推一个 filter 的话过滤条件整个消失，
      // 「查无此班」会变成「全站统计」
      filters.push(
        matchedIds.length
          ? inArray(schema.submission.userId, matchedIds)
          : sql`false`,
      )
    }
    const where = and(...filters)
    // 花名册：只有未禁用的普通用户算进班级人数和「谁没做」，教师和管理员不进分母
    const rosterRows = matched.filter(
      (row) => !row.isDisabled && row.adminType === "Regular User",
    )

    const acceptedFilter = sql`count(*) filter (where ${inArray(schema.submission.result, ACCEPTED_RESULTS)})`
    // 判题中的条数。要单独数出来，正确率的分母才能把它们摘掉
    const judgingFilter = sql`count(*) filter (where ${inArray(schema.submission.result, UNJUDGED_RESULTS)})`
    /**
     * **解决的题数**，不是通过的提交条数。同一道题重复 AC（改完再交一次仍然对）
     * 在这里只算一道 —— 表格那一列叫「已解决」，数条数就名不副实了。
     * 指定了题号时它最多是 1，不指定时才看得出差别（老师查「这节课全班」就是这种）。
     */
    const solvedFilter = sql`count(distinct ${schema.submission.problemId}) filter (where ${inArray(schema.submission.result, ACCEPTED_RESULTS)})`

    const [[totals], perUser] = await Promise.all([
      db
        .select({
          total: count(),
          accepted: acceptedFilter.mapWith(Number),
          judging: judgingFilter.mapWith(Number),
        })
        .from(schema.submission)
        .where(where),
      db
        .select({
          userId: schema.submission.userId,
          /**
           * 显示的是**当前**用户名，从 user 表 join 出来 —— 按 submission.username
           * 分组的话，改过名的学生会裂成新旧两行，两边各算各的，谁都够不到「全做完」。
           *
           * 已删号的学生 user 表里没有行，退回提交里冻结的那份名字（下面的
           * personCount 兜底就是给这种情况的）。
           */
          username: sql<string>`coalesce(${schema.user.username}, max(${schema.submission.username}))`,
          className: schema.user.className,
          // 不传用户名时「交了没全对」那一栏靠它把教师和禁用账号挡在外面 ——
          // 传了用户名时这件事是花名册（rosterRows）做的
          isDisabled: schema.user.isDisabled,
          adminType: schema.user.adminType,
          submissionCount: count(),
          acceptedCount: acceptedFilter.mapWith(Number),
          solvedCount: solvedFilter.mapWith(Number),
          judgingCount: judgingFilter.mapWith(Number),
        })
        .from(schema.submission)
        .leftJoin(schema.user, eq(schema.user.id, schema.submission.userId))
        .where(where)
        // user_id 定了 user 那一行就定了，把 username / class_name 一起放进 group by
        // 不会多分出组来，但省掉再对它们套一层聚合函数
        .groupBy(
          schema.submission.userId,
          schema.user.username,
          schema.user.className,
          schema.user.isDisabled,
          schema.user.adminType,
        )
        .orderBy(desc(count())),
    ])

    const submissionCount = totals?.total ?? 0
    const acceptedCount = totals?.accepted ?? 0
    const judgingCount = totals?.judging ?? 0
    // 正确率的分母是**判完的条数**，不是总条数
    const judgedCount = submissionCount - judgingCount

    /**
     * 「做完了」的判定。**指定了几道题，就要几道都解决**（这是教师选的口径：
     * 「今天布置三道，谁全做完了」）—— 做出两道差一道的人落在「交了没全对」那一栏，
     * 那里带着 `solvedCount`，老师看得出他差几道。
     *
     * 只填一道题时 `solvedCount >= 1` 和原来的 `acceptedCount > 0` 完全等价；
     * 不填题号时无所谓「全部」，退回「至少做出一道」。
     */
    const requiredSolved = scope.problemCount
    const isDone = (row: { solvedCount: number; acceptedCount: number }) =>
      requiredSolved > 0
        ? row.solvedCount >= requiredSolved
        : row.acceptedCount > 0

    /**
     * 「提交记录」那张表列的是**窗口里交过东西的所有人**，`done` 标出谁做完了 ——
     * 原来只给做完的人，于是一次没对的学生连同他的提交在这张表里根本不存在，
     * 教师想看「他到底错在哪」得切到提交列表再翻。展开一行拉的是那个人的全部
     * 提交（GET /submissions/statistics/items 不按结果过滤），对错都在里面。
     *
     * 「完成人数」这些数字跟着 `done` 算，不是 `data.length`。
     */
    const doneCount = perUser.filter(isDone).length
    // 要等 perUser 回来才能查，所以进不了上面那个 Promise.all
    const astOnlyByUserMap = await astOnlyByUser(
      where,
      perUser.map((row) => row.userId),
    )

    const submittedUserIds = new Set(perUser.map((row) => row.userId))

    const data = perUser.map((row) => ({
      username: row.username,
      className: row.className,
      submissionCount: row.submissionCount,
      acceptedCount: row.acceptedCount,
      solvedCount: row.solvedCount,
      astOnlyCount: astOnlyByUserMap.get(row.userId) ?? 0,
      judgingCount: row.judgingCount,
      correctRate: judgedRate(
        row.acceptedCount,
        row.submissionCount - row.judgingCount,
      ),
      done: isDone(row),
    }))

    const dataUnaccepted = rosterRows
      .filter((row) => !submittedUserIds.has(row.id))
      .map((row) => ({
        username: row.username,
        realName: stripClassPrefix(row.username, row.className),
      }))

    /**
     * 交了但没做完的：包括一道都没对的，也包括三道里做出两道的。
     *
     * **传了用户名时按花名册取**，和 dataUnaccepted 同一个范围，查一个班不会冒出
     * 一堆别的班的人。
     *
     * 不传用户名时没有花名册，这一栏原先跟着空掉 —— 于是只交了错误答案的学生
     * 「已完成」那张表进不去（没做完）、「未完成」那一栏也没有，整个人从屏幕上
     * 消失，看起来就像统计只认成功的提交。这种情况退回「有提交但没做完的全部人」，
     * 教师和禁用账号照样排除（否则老师自己试题留下的错误提交会混进点名名单）。
     *
     * 「还没交」那一栏没有花名册是真的算不出来（不知道该有谁），仍然为空。
     */
    const rosterIds = new Set(rosterRows.map((row) => row.id))
    const attemptedRows = perUser.filter((row) => {
      if (isDone(row)) return false
      return username
        ? rosterIds.has(row.userId)
        : !row.isDisabled && row.adminType === "Regular User"
    })
    const failureByUser = await lastFailureByUser(
      where,
      attemptedRows.map((row) => row.userId),
    )
    const dataAttempted = attemptedRows.map((row) => ({
      username: row.username,
      /**
       * 剥前缀只在**查了某个班**的时候做：那时满屏都是同一个班，留着 `ks251` 是噪音。
       * 不传用户名的全站视图里各班混在一起，剥完只剩一串重名的名字，反而认不出谁，
       * 所以原样给完整用户名。班名取 perUser join 出来的那一列，和花名册同一份数据。
       */
      realName: username
        ? stripClassPrefix(row.username, row.className)
        : row.username,
      submissionCount: row.submissionCount,
      solvedCount: row.solvedCount,
      lastFailure: failureByUser.get(row.userId) ?? null,
    }))

    // 「学生已删号但提交记录还在」时完成人数会大于花名册人数，分母兜到完成人数为止。
    // 旧后端在这之前还先算了一个 person_rate 一起下发，前端从来没读过它（完成度是
    // 前端自己按「减掉请假人数之后的分母」重算的），所以这条链路上只留 person_count。
    let personCount = rosterRows.length
    if (personCount && personCount < doneCount) personCount = doneCount

    return success(c, {
      submissionCount,
      acceptedCount,
      judgingCount,
      correctRate: judgedRate(acceptedCount, judgedCount),
      personCount,
      data,
      dataUnaccepted,
      dataAttempted,
    } satisfies SubmissionStatistics)
  },
)

/**
 * 统计面板展开一行时拉这个人的提交明细。
 *
 * 用户名这里是**精确匹配**，不是统计接口那种 ilike —— 那边填 `ks251` 要圈出整个班，
 * 这边是「点开的这一行是谁」。时间窗和题号沿用同一个 scope，不然展开行看到的
 * 会是另一个范围的数据。
 */
submissionStatisticsRoutes.get(
  "/submissions/statistics/items",
  requireTeacher,
  async (c) => {
    const username = c.req.query("username")?.trim()
    if (!username)
      return failure(c, 400, "invalid-request", "username is required")

    const scope = await statisticsScope(c)
    if (!scope.ok) return failure(c, scope.status, scope.code, scope.message)

    /**
     * 展开的那一行给的是**当前**用户名，先换成 user_id 再查 —— 直接按
     * `submission.username` 精确匹配的话，改过名的学生展开来是空的（他的提交
     * 全挂在旧名字下）。
     *
     * 查不到账号才退回按提交里冻结的用户名匹配：已删号的学生仍然会出现在统计
     * 表格里（那一行的名字取自提交），展开行不能因此空着。
     */
    const [account] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.username, username))
      .limit(1)
    const identity = account
      ? eq(schema.submission.userId, account.id)
      : eq(schema.submission.username, username)

    // 多取一条，好知道是不是被截断了
    // innerJoin 不会漏行：submission.problem_id 是 NOT NULL 且外键是 NO ACTION，
    // 题目删不掉（真要删会被外键拦住并提示改为隐藏）
    const rows = await db
      .select({
        id: schema.submission.id,
        result: schema.submission.result,
        createTime: schema.submission.createTime,
        problem: schema.problem.displayId,
        problemTitle: schema.problem.title,
      })
      .from(schema.submission)
      .innerJoin(
        schema.problem,
        eq(schema.problem.id, schema.submission.problemId),
      )
      .where(and(...scope.filters, identity))
      .orderBy(desc(schema.submission.createTime), desc(schema.submission.id))
      .limit(STATISTICS_ITEMS_LIMIT + 1)

    const truncated = rows.length > STATISTICS_ITEMS_LIMIT
    return success(c, {
      items: rows.slice(0, STATISTICS_ITEMS_LIMIT),
      truncated,
    } satisfies SubmissionStatisticsItems)
  },
)
