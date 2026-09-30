/**
 * 教师统计：今日提交分布、按学生/题目的统计面板、展开行的提交明细。
 *
 * 从 submission.ts 拆出来的一整块。**挂载位置不能动**：submission.ts 在原位置
 * `route("/", submissionStatisticsRoutes)`，必须排在 `/submissions/:id` 之前，
 * 否则 `/submissions/statistics` 会被当成 id 吞掉（Hono 按注册顺序匹配）。
 */

import {
  NO_CLASS,
  type ProblemLanguage,
  type SubmissionLessons,
  type SubmissionStatistics,
  type SubmissionStatisticsGrid,
  type TodaySubmissionStatistics,
} from "@oj2/contract"
import { and, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, requireTeacher } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus, UNJUDGED_RESULTS, type JudgeStatusValue } from "../judge/status"
import { type ContestEnv } from "../services/contest"
import { getBooleanOption } from "../services/options"
import { dayStart, localTime } from "../time"
import {
  classCondition,
  isAdminRole,
  parseDisplayIds,
  rounded,
  scopedUsers,
  stripClassPrefix,
} from "./helpers"

export const submissionStatisticsRoutes = new Hono<ContestEnv>()

const ACCEPTED_RESULTS: JudgeStatusValue[] = [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]

/** 正确率。分母是判完的条数，一条都还没判完时给 0 而不是 NaN */
function judgedRate(accepted: number, judged: number) {
  return judged > 0 ? rounded((accepted / judged) * 100) : 0
}

type TodayRow = {
  problem_id: number
  display_id: string
  title: string
  visible: boolean
  user_id: number
  result: JudgeStatusValue
  language: ProblemLanguage
}

/**
 * 「今日统计」（提交列表顶上那颗标签点开的），只剩学生版 —— 老师那一版并进了统计的
 * 「一行一节课」（下面的 /submissions/statistics/lessons）。口径和那颗标签一致：东八区今天 + 非比赛提交。
 *
 * 今天的提交一天也就几百到一千来条，整批拉回来在进程里分组，比写五六条各自 group by 的
 * SQL 好读，也只扫一遍 `create_time` 索引。
 */
submissionStatisticsRoutes.get("/submissions/today-statistics", optionalAuth, async (c) => {
  const user = c.get("user")
  /**
   * 「提交列表对学生全开」关掉时（考试那种场合）不给题目这张表 —— 总数、正确率
   * 这些聚合数原本就从公开的 today-count 看得出来，但「哪几道题在被刷」已经贴近
   * 提交列表本身的内容了，得跟着同一个开关走。数字照给，不然标签说 21、弹框说 0。
   */
  const showProblems =
    (await getBooleanOption("submission_list_show_all", true)) || isAdminRole(user)
  const since = dayStart()
  const [rows, [flow]] = await Promise.all([
    db.execute<TodayRow>(sql`
      select s.problem_id, p._id as display_id, p.title, p.visible,
        s.user_id, s.result, s.language
      from ${schema.submission} s
      join ${schema.problem} p on p.id = s.problem_id
      where s.contest_id is null and s.create_time >= ${since}
    `),
    db
      .select({ value: count() })
      .from(schema.flowchartSubmission)
      .where(sql`${schema.flowchartSubmission.createTime} >= ${since}`),
  ])

  const isAccepted = (row: TodayRow) => ACCEPTED_RESULTS.includes(row.result)
  const isJudging = (row: TodayRow) => UNJUDGED_RESULTS.includes(row.result)
  const rate = (list: TodayRow[]) => {
    const judging = list.filter(isJudging).length
    return judgedRate(list.filter(isAccepted).length, list.length - judging)
  }
  const distinctUsers = (list: TodayRow[]) => new Set(list.map((row) => row.user_id)).size
  const acceptedUsers = (list: TodayRow[]) =>
    new Set(list.filter(isAccepted).map((row) => row.user_id)).size
  const groupBy = <K>(list: TodayRow[], key: (row: TodayRow) => K) => {
    const map = new Map<K, TodayRow[]>()
    for (const row of list) map.set(key(row), [...(map.get(key(row)) ?? []), row])
    return map
  }
  const countBy = <K>(list: TodayRow[], key: (row: TodayRow) => K) =>
    [...groupBy(list, key)]
      .map(([value, group]) => ({ value, count: group.length }))
      .sort((a, b) => b.count - a.count)

  const judging = rows.filter(isJudging).length
  const byProblem = groupBy(rows, (row) => row.problem_id)
  const mineRows = user ? rows.filter((row) => row.user_id === user.id) : []

  // 大家都在做
  const problems = showProblems
    ? [...byProblem.values()]
        .filter((list) => list[0]!.visible)
        .map((list) => {
          const mine = user ? list.filter((row) => row.user_id === user.id) : []
          return {
            problemDisplayId: list[0]!.display_id,
            problemTitle: list[0]!.title,
            userCount: distinctUsers(list),
            acceptedUsers: acceptedUsers(list),
            mine: !user
              ? null
              : mine.some(isAccepted)
                ? ("accepted" as const)
                : mine.length
                  ? ("tried" as const)
                  : ("none" as const),
          }
        })
        .sort((a, b) => b.userCount - a.userCount)
        .slice(0, 8)
    : []

  return success(c, {
    asOf: new Date().toISOString(),
    total: rows.length,
    accepted: rows.filter(isAccepted).length,
    judging,
    correctRate: rate(rows),
    userCount: distinctUsers(rows),
    flowchartCount: flow?.value ?? 0,
    languages: countBy(rows, (row) => row.language).map(({ value, count }) => ({
      language: value,
      count,
    })),
    results: countBy(rows, (row) => row.result).map(({ value, count }) => ({
      result: value,
      count,
    })),
    me: user
      ? {
          total: mineRows.length,
          solved: new Set(mineRows.filter(isAccepted).map((row) => row.problem_id)).size,
        }
      : null,
    problems,
  } satisfies TodaySubmissionStatistics)
})

/**
 * 统计接口共用的时间窗解析。旧后端 `end` 必填、`start` 可选（不给就是「全部时段」）。
 */
function statisticsRange(c: { req: { query(name: string): string | undefined } }) {
  const end = c.req.query("end")?.trim()
  if (!end) return null
  const start = c.req.query("start")?.trim()
  return { start: start || null, end }
}

/** 一次最多查几道题。课堂上一节课布置三五道，20 是留足了余量的上限 */
const STATISTICS_MAX_PROBLEMS = 20

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
 * 用户名**精确**匹配。usernameFilter 是「包含」，学号互相包含是常态（ks24a1 包含在 ks24a10 里），
 * 协作中老师看「这个学生」的提交时不能把别人的也捞进来。查无此人留恒假条件
 */
export async function exactUsernameFilter(username: string) {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.username, username))
    .limit(1)
  return row ? eq(schema.submission.userId, row.id) : sql`false`
}

/**
 * 按班级筛：`user.class_name` 精确匹配。原来列表只能拿用户名前缀（`ks253`）当班级，
 * 那是「包含」匹配 —— ks253 会顺带捞进 ks2531 这类撞前缀的号，也要老师记得前缀怎么拼。
 * 查无此班留恒假条件
 */
export async function classNameFilter(className: string) {
  const users = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(classCondition(className))
  return users.length
    ? inArray(
        schema.submission.userId,
        users.map((row) => row.id),
      )
    : sql`false`
}

/**
 * 两条提交列表的题号筛选：先把题号解析成 problem.id，再按 `submission.problem_id` 筛。
 * 可以一次填几道（`1021,1022`），**任一道**对上就算。
 * 原来是 join problem 之后比 `lower(problem._id)`，条件落在 problem 表上，规划器只能
 * 顺着时间索引倒扫、逐行回表比对，走不上 submission_public_problem_time_idx。
 *
 * 公开列表只认公开题、比赛列表只认本场的题：题号只在这个范围内唯一（比赛题的 `_id`
 * 和公开题撞号是常态），而公开提交从不指向比赛题（快照核过，0 条）。
 * 查无此题时留恒假条件，少推一个 filter 就成了「不筛」。
 */
/**
 * 题号框里查不到的那几个（范围同 problemFilter：公开列表只认公开题，比赛列表只认本场的题）。
 * 列表把它们回给前端，打错一个字的时候老师能看到提示
 */
export async function unknownDisplayIds(displayId: string, contestId: number | null) {
  const ids = parseDisplayIds(displayId)
  if (!ids.length) return []
  const rows = await db
    .select({ displayId: schema.problem.displayId })
    .from(schema.problem)
    .where(
      and(
        inArray(
          sql`lower(${schema.problem.displayId})`,
          ids.map((id) => id.toLowerCase()),
        ),
        contestId === null
          ? isNull(schema.problem.contestId)
          : eq(schema.problem.contestId, contestId),
      ),
    )
  const found = new Set(rows.map((row) => row.displayId.toLowerCase()))
  return ids.filter((id) => !found.has(id.toLowerCase()))
}

export async function problemFilter(displayId: string, contestId: number | null) {
  // 一次可以筛几道（「这节课」那颗按钮一带就是五道），分隔符和统计面板同一套
  const lowered = parseDisplayIds(displayId).map((id) => id.toLowerCase())
  if (!lowered.length) return sql`false`
  const problems = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(
      and(
        inArray(sql`lower(${schema.problem.displayId})`, lowered),
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
  if (range.start) filters.push(sql`${schema.submission.createTime} >= ${range.start}`)

  const displayIds = parseDisplayIds(c.req.query("problemDisplayId") ?? "")
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

submissionStatisticsRoutes.get("/submissions/statistics", requireTeacher, async (c) => {
  const scope = await statisticsScope(c)
  if (!scope.ok) return failure(c, scope.status, scope.code, scope.message)
  const filters = scope.filters

  const username = c.req.query("username")?.trim() || undefined
  const className = c.req.query("className")?.trim() || undefined
  // 用户名 / 班级先解析成账号，再拿 user_id 去筛提交。这一趟查询挡在 Promise.all 前面，
  // 但换掉的是下面**四条**语句各一次的 submission 全表扫：`ilike` 走不了索引，
  // 换成 `user_id in (...)` 之后四条全走索引（生产快照实测单条 18448 → 537
  // buffers；同一个快照上整个接口查一个班 120~250ms → 10ms 上下），多这一次往返是赚的。
  const scoped = await scopedUsers(username, className)
  const matched = scoped ?? []
  if (scoped) {
    const matchedIds = matched.map((row) => row.id)
    // 一个账号都没匹配上时得留个恒假条件。少推一个 filter 的话过滤条件整个消失，
    // 「查无此班」会变成「全站统计」
    filters.push(matchedIds.length ? inArray(schema.submission.userId, matchedIds) : sql`false`)
  }
  const where = and(...filters)
  // 花名册：只有未禁用的普通用户算进班级人数和「谁没做」，教师和管理员不进分母
  const enrolled = matched.filter((row) => !row.isDisabled && row.adminType === "Regular User")

  const acceptedFilter = sql`count(*) filter (where ${inArray(schema.submission.result, ACCEPTED_RESULTS)})`
  // 判题中的条数。要单独数出来，正确率的分母才能把它们摘掉
  const judgingFilter = sql`count(*) filter (where ${inArray(schema.submission.result, UNJUDGED_RESULTS)})`
  /**
   * **解决的题数**，不是通过的提交条数。同一道题重复 AC（改完再交一次仍然对）
   * 在这里只算一道 —— 表格那一列叫「已解决」，数条数就名不副实了。
   * 指定了题号时它最多是 1，不指定时才看得出差别（老师查「这节课全班」就是这种）。
   */
  const solvedFilter = sql`count(distinct ${schema.submission.problemId}) filter (where ${inArray(schema.submission.result, ACCEPTED_RESULTS)})`

  const [[totals], perUser, results] = await Promise.all([
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
    // 数字行里那根结果条（原来今日统计底部那根，并进来之后哪个时间段都有）
    db
      .select({ result: schema.submission.result, count: count() })
      .from(schema.submission)
      .where(where)
      .groupBy(schema.submission.result)
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
    requiredSolved > 0 ? row.solvedCount >= requiredSolved : row.acceptedCount > 0

  /**
   * 「提交记录」那张表列的是**窗口里交过东西的所有人**，`done` 标出谁做完了 ——
   * 原来只给做完的人，于是一次没对的学生连同他的提交在这张表里根本不存在，
   * 教师想看「他到底错在哪」得切到提交列表再翻。展开一行拉的是那个人的全部
   * 提交，对错都在里面。
   *
   * 「完成人数」这些数字跟着 `done` 算，不是 `data.length`。
   */
  const doneCount = perUser.filter(isDone).length

  const submittedUserIds = new Set(perUser.map((row) => row.userId))
  /**
   * 「没填班级」不是一个真的班：两百来个夏令营、兴趣班、自己注册的号混在一起，「还没交」
   * 列出来全是不相干的人，分母也跟着失真。花名册只取这段时间交过的人 —— 「交了没对」照常有，
   * 「还没交」为空，和不选班时一样
   */
  const rosterRows =
    className === NO_CLASS ? enrolled.filter((row) => submittedUserIds.has(row.id)) : enrolled

  const data = perUser.map((row) => ({
    username: row.username,
    className: row.className,
    submissionCount: row.submissionCount,
    acceptedCount: row.acceptedCount,
    solvedCount: row.solvedCount,
    judgingCount: row.judgingCount,
    correctRate: judgedRate(row.acceptedCount, row.submissionCount - row.judgingCount),
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
    return scoped ? rosterIds.has(row.userId) : !row.isDisabled && row.adminType === "Regular User"
  })
  const dataAttempted = attemptedRows.map((row) => ({
    username: row.username,
    /**
     * 剥前缀只在**查了某个班**的时候做：那时满屏都是同一个班，留着 `ks251` 是噪音。
     * 不传用户名的全站视图里各班混在一起，剥完只剩一串重名的名字，反而认不出谁，
     * 所以原样给完整用户名。班名取 perUser join 出来的那一列，和花名册同一份数据。
     */
    realName: scoped ? stripClassPrefix(row.username, row.className) : row.username,
    submissionCount: row.submissionCount,
    solvedCount: row.solvedCount,
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
    results,
  } satisfies SubmissionStatistics)
})

/** 方块串一次最多给多少条。一个班一个月七八百条，5000 是全年级查一周的量 */
const GRID_LIMIT = 5000

/**
 * 统计页的方块串：范围内每个学生的每一次提交（口径见契约 submissionStatisticsGridSchema）。
 * 用户名的匹配和统计接口同一套（ilike，填 `ks253` 圈一个班）。
 */
submissionStatisticsRoutes.get("/submissions/statistics/grid", requireTeacher, async (c) => {
  const scope = await statisticsScope(c)
  if (!scope.ok) return failure(c, scope.status, scope.code, scope.message)
  const filters = [...scope.filters]

  const username = c.req.query("username")?.trim() || undefined
  const scoped = await scopedUsers(username, c.req.query("className")?.trim() || undefined)
  if (scoped) {
    const ids = scoped.map((row) => row.id)
    filters.push(ids.length ? inArray(schema.submission.userId, ids) : sql`false`)
  }

  const rows = await db
    .select({
      id: schema.submission.id,
      userId: schema.submission.userId,
      problemId: schema.submission.problemId,
      result: schema.submission.result,
      createTime: schema.submission.createTime,
      username: schema.user.username,
      className: schema.user.className,
    })
    .from(schema.submission)
    // 只要普通学生：老师试题的提交不该出现在「谁做了几次」里
    .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
    .where(
      and(...filters, eq(schema.user.adminType, "Regular User"), eq(schema.user.isDisabled, false)),
    )
    .orderBy(desc(schema.submission.createTime))
    .limit(GRID_LIMIT + 1)
  const truncated = rows.length > GRID_LIMIT
  const kept = rows.slice(0, GRID_LIMIT).reverse()

  // 题目：传了就按传的顺序，没传就按范围里第一次有人交的时间
  const requested = parseDisplayIds(c.req.query("problemDisplayId") ?? "")
  const problemIds = [...new Set(kept.map((row) => row.problemId))]
  const problems = problemIds.length
    ? await db
        .select({
          id: schema.problem.id,
          displayId: schema.problem.displayId,
          title: schema.problem.title,
        })
        .from(schema.problem)
        .where(inArray(schema.problem.id, problemIds))
    : []
  const problemById = new Map(problems.map((row) => [row.id, row]))
  const ordered = requested.length
    ? requested.flatMap((id) => {
        const hit = problems.find((row) => row.displayId.toLowerCase() === id.toLowerCase())
        return hit ? [hit] : []
      })
    : problemIds.map((id) => problemById.get(id)!).filter(Boolean)
  // 传了题号但这些题在范围里没人交：表头仍然要有它们
  if (requested.length && ordered.length < requested.length) {
    const missing = requested.filter(
      (id) => !ordered.some((row) => row.displayId.toLowerCase() === id.toLowerCase()),
    )
    const { ids } = await findPublicProblemsByDisplayIds(missing)
    if (ids.length) {
      const extra = await db
        .select({
          id: schema.problem.id,
          displayId: schema.problem.displayId,
          title: schema.problem.title,
        })
        .from(schema.problem)
        .where(inArray(schema.problem.id, ids))
      ordered.push(...extra)
      const rank = new Map(requested.map((id, i) => [id.toLowerCase(), i]))
      ordered.sort(
        (a, b) =>
          (rank.get(a.displayId.toLowerCase()) ?? 0) - (rank.get(b.displayId.toLowerCase()) ?? 0),
      )
    }
  }

  const byUser = new Map<number, SubmissionStatisticsGrid["rows"][number]>()
  for (const row of kept) {
    let entry = byUser.get(row.userId)
    if (!entry) {
      entry = {
        username: row.username,
        realName: stripClassPrefix(row.username, row.className),
        className: row.className,
        submissions: [],
      }
      byUser.set(row.userId, entry)
    }
    entry.submissions.push({
      id: row.id,
      problemDisplayId: problemById.get(row.problemId)?.displayId ?? "",
      result: row.result,
      createTime: row.createTime,
    })
  }

  // 按班级汇总时要知道每个班多少人，「一道没交」才算得出来
  const classSizes: Record<string, number> = {}
  if (!scoped) {
    const names = [...new Set(kept.map((row) => row.className).filter((name) => name !== null))]
    if (names.length) {
      const sizes = await db
        .select({ className: schema.user.className, value: count() })
        .from(schema.user)
        .where(
          and(
            inArray(schema.user.className, names as string[]),
            eq(schema.user.adminType, "Regular User"),
            eq(schema.user.isDisabled, false),
          ),
        )
        .groupBy(schema.user.className)
      for (const row of sizes) if (row.className) classSizes[row.className] = row.value
    }
  }

  return success(c, {
    problems: ordered.map((row) => ({ problemDisplayId: row.displayId, title: row.title })),
    rows: [...byUser.values()],
    classSizes,
    truncated,
  } satisfies SubmissionStatisticsGrid)
})

/** 相邻两条提交隔这么久，就当下课了、后面的是另一段 */
const LESSON_GAP_MINUTES = 30
/** 一段里有一道题这么多人做过，才算一节课（和原来今日统计、首页「班里在做」同一个门槛） */
const LESSON_MIN_USERS = 5
/** 最后一条在这么多分钟内，算「还在上课」 */
const LESSON_LIVE_MINUTES = 15
/** 一次列多少节课。「一节课」「今天」一般一两行，「这学期」「全部」有几百节，先给最近的这些 */
const LESSONS_DEFAULT = 50
const LESSONS_MAX = 500

type LessonAggRow = {
  level: number
  class_name: string | null
  day: string | null
  sid: number | null
  problem_id: number | null
  result: JudgeStatusValue | null
  lesson: boolean | null
  users: number
  total: number
  accepted: number
  judging: number
  from_ps: number
  first: string
  last: string
  accepted_users: number
}

/**
 * 统计「一行一节课」的总览（口径见契约 submissionLessonsSchema）。
 *
 * 切课、零散提交、错得最多的题全在一条 SQL 里：先按「班 + 东八区哪一天」隔 30 分钟切段，
 * 再标出哪几段算课，最后用 grouping sets 一次聚合出下面五种粒度 —— 不走方块串那个明细
 * 接口在前端切，是因为那边最多给 5000 条，「这学期」就不止这个数，截断之后课会少算。
 */
submissionStatisticsRoutes.get("/submissions/statistics/lessons", requireTeacher, async (c) => {
  const range = statisticsRange(c)
  if (!range) return failure(c, 400, "invalid-request", "end is required")
  const limit = Math.min(
    LESSONS_MAX,
    Math.max(1, Number.parseInt(c.req.query("limit") ?? "", 10) || LESSONS_DEFAULT),
  )
  const accepted = sql.join(
    ACCEPTED_RESULTS.map((value) => sql`${value}`),
    sql`, `,
  )
  const judging = sql.join(
    UNJUDGED_RESULTS.map((value) => sql`${value}`),
    sql`, `,
  )

  // grouping() 的位：class_name 32、day 16、sid 8、problem_id 4、result 2、lesson 1。
  // 没参与分组的那几列记 1，所以每种粒度对应一个固定的 level
  const rows = await db.execute<LessonAggRow>(sql`
    with s as (
      select u.class_name, s.user_id, s.problem_id, s.result, s.problemset_id, s.create_time,
        to_char(${localTime(sql`s.create_time`)}, 'YYYY-MM-DD') as day
      from ${schema.submission} s
      join ${schema.user} u on u.id = s.user_id
      where s.contest_id is null
        and s.create_time <= ${range.end}
        ${range.start ? sql`and s.create_time >= ${range.start}` : sql``}
        -- 只算普通学生：老师试题的提交不该把一段拼成「一节课」
        and u.admin_type = 'Regular User' and u.is_disabled = false
    ),
    g as (
      select *,
        case when create_time - lag(create_time) over w > ${`${LESSON_GAP_MINUTES} minutes`}::interval
          then 1 else 0 end as brk
      from s
      window w as (partition by class_name, day order by create_time)
    ),
    seg as (
      select *,
        sum(brk) over (partition by class_name, day order by create_time rows unbounded preceding) as sid
      from g
    ),
    lesson_seg as (
      select class_name, day, sid
      from (
        select class_name, day, sid, problem_id, count(distinct user_id) as n
        from seg
        group by class_name, day, sid, problem_id
      ) p
      group by class_name, day, sid
      having max(n) >= ${LESSON_MIN_USERS}
    ),
    marked as (
      select seg.*, (l.sid is not null) as lesson
      from seg
      left join lesson_seg l
        -- 没填班级的号（class_name 为 null）合在一起当一个班切，= 会把它们全漏掉
        on l.class_name is not distinct from seg.class_name and l.day = seg.day and l.sid = seg.sid
    )
    select grouping(class_name, day, sid, problem_id, result, lesson) as level,
      class_name, day, sid::int as sid, problem_id, result, lesson,
      count(distinct user_id)::int as users,
      count(*)::int as total,
      (count(*) filter (where result in (${accepted})))::int as accepted,
      (count(*) filter (where result in (${judging})))::int as judging,
      (count(*) filter (where problemset_id is not null))::int as from_ps,
      min(create_time) as first,
      max(create_time) as last,
      (count(distinct user_id) filter (where result in (${accepted})))::int as accepted_users
    from marked
    group by grouping sets (
      (class_name, day, sid, problem_id),
      (class_name, day, sid, lesson),
      (problem_id, class_name),
      (problem_id, result),
      (lesson, class_name, day)
    )
  `)

  const LEVEL = { segProblem: 3, segment: 6, problemClass: 27, problemResult: 57, dayClass: 14 }
  const segKey = (row: LessonAggRow) => `${row.class_name}|${row.day}|${row.sid}`
  const failedOf = (row: { total: number; accepted: number; judging: number }) =>
    row.total - row.accepted - row.judging

  const problemsOfSeg = new Map<string, LessonAggRow[]>()
  for (const row of rows) {
    if (row.level !== LEVEL.segProblem) continue
    const key = segKey(row)
    problemsOfSeg.set(key, [...(problemsOfSeg.get(key) ?? []), row])
  }
  const allLessons = rows
    .filter((row) => row.level === LEVEL.segment && row.lesson)
    .sort((a, b) => b.first.localeCompare(a.first))
  const picked = allLessons.slice(0, limit)
  const hasMore = allLessons.length > limit

  // 题号、标题一次查齐：课的题、每节课错得最多的那道、整段时间错得最多的几道
  const hardCandidates = new Map<number, { rows: LessonAggRow[]; failures: LessonAggRow[] }>()
  for (const row of rows) {
    if (row.problem_id === null) continue
    if (row.level === LEVEL.problemClass || row.level === LEVEL.problemResult) {
      const entry = hardCandidates.get(row.problem_id) ?? { rows: [], failures: [] }
      if (row.level === LEVEL.problemClass) entry.rows.push(row)
      else entry.failures.push(row)
      hardCandidates.set(row.problem_id, entry)
    }
  }
  const hardRanked = [...hardCandidates.entries()]
    .map(([problemId, entry]) => {
      const sum = (key: "total" | "accepted" | "judging" | "users" | "accepted_users") =>
        entry.rows.reduce((acc, row) => acc + row[key], 0)
      return {
        problemId,
        className: [...entry.rows].sort((a, b) => b.total - a.total)[0]?.class_name ?? null,
        total: sum("total"),
        accepted: sum("accepted"),
        judging: sum("judging"),
        userCount: sum("users"),
        acceptedUsers: sum("accepted_users"),
        failures: entry.failures
          .filter(
            (row) =>
              row.result !== null &&
              !ACCEPTED_RESULTS.includes(row.result) &&
              !UNJUDGED_RESULTS.includes(row.result),
          )
          .sort((a, b) => b.total - a.total)
          .map((row) => ({ result: row.result!, count: row.total })),
      }
    })
    .filter((row) => failedOf(row) > 0)
    .sort((a, b) => failedOf(b) - failedOf(a))
    .slice(0, 6)

  const lessonProblemRows = picked.map((lesson) =>
    (problemsOfSeg.get(segKey(lesson)) ?? [])
      .filter((row) => row.users >= LESSON_MIN_USERS)
      .sort((a, b) => b.users - a.users),
  )
  const problemIds = [
    ...new Set([
      ...lessonProblemRows.flat().map((row) => row.problem_id!),
      ...hardRanked.map((row) => row.problemId),
    ]),
  ]
  const problems = problemIds.length
    ? await db
        .select({
          id: schema.problem.id,
          displayId: schema.problem.displayId,
          title: schema.problem.title,
          visible: schema.problem.visible,
        })
        .from(schema.problem)
        .where(inArray(schema.problem.id, problemIds))
    : []
  const problemById = new Map(problems.map((row) => [row.id, row]))

  const lessonClasses = [
    ...new Set(picked.flatMap((row) => (row.class_name === null ? [] : [row.class_name]))),
  ]
  const sizes = lessonClasses.length
    ? await db
        .select({ className: schema.user.className, value: count() })
        .from(schema.user)
        .where(
          and(
            inArray(schema.user.className, lessonClasses),
            eq(schema.user.adminType, "Regular User"),
            eq(schema.user.isDisabled, false),
          ),
        )
        .groupBy(schema.user.className)
    : []

  const sum = (list: LessonAggRow[], key: "total" | "accepted" | "judging") =>
    list.reduce((acc, row) => acc + row[key], 0)
  const liveSince = new Date(Date.now() - LESSON_LIVE_MINUTES * 60_000).toISOString()
  const lessons = picked.map((lesson, index) => {
    const own = lessonProblemRows[index]!
    const hardest = [...own].sort((a, b) => failedOf(b) - failedOf(a))[0]
    const hardestProblem = hardest ? problemById.get(hardest.problem_id!) : undefined
    return {
      className: lesson.class_name,
      day: lesson.day!,
      start: lesson.first,
      end: lesson.last,
      userCount: lesson.users,
      // 没填班级的谈不上花名册，给 0（界面上就只写「几人」）
      classSize:
        lesson.class_name === null
          ? 0
          : (sizes.find((row) => row.className === lesson.class_name)?.value ?? 0),
      // 点进去就拿这几道去筛：统计接口只认公开题，一次最多 20 道
      problems: own
        .map((row) => problemById.get(row.problem_id!))
        .filter((row) => row?.visible)
        .map((row) => row!.displayId)
        .slice(0, STATISTICS_MAX_PROBLEMS),
      fromProblemSet: lesson.from_ps * 2 > lesson.total,
      // 次数和正确率只算这节课的题：点进去筛的就是这几道，两边的数才对得上
      // （一段里零星一两个人顺手交的别的题不算）
      total: sum(own, "total"),
      correctRate: judgedRate(sum(own, "accepted"), sum(own, "total") - sum(own, "judging")),
      live: lesson.last >= liveSince,
      hardest:
        hardest && hardestProblem && failedOf(hardest) > 0
          ? {
              problemDisplayId: hardestProblem.displayId,
              problemTitle: hardestProblem.title,
              failed: failedOf(hardest),
            }
          : null,
    }
  })

  // 零散提交只给列出来的这些课覆盖到的日子（「这学期」只列了最近 50 节时，更早的零散不给）
  const earliestDay = hasMore ? (picked.at(-1)?.day ?? null) : null
  const scattered = rows
    .filter(
      (row) =>
        row.level === LEVEL.dayClass &&
        row.lesson === false &&
        (earliestDay === null || row.day! >= earliestDay),
    )
    .sort((a, b) =>
      a.day !== b.day
        ? b.day!.localeCompare(a.day!)
        : a.class_name === null
          ? 1
          : b.class_name === null
            ? -1
            : b.total - a.total,
    )
    .map((row) => ({
      day: row.day!,
      className: row.class_name,
      userCount: row.users,
      total: row.total,
    }))

  return success(c, {
    lessons,
    scattered,
    hardProblems: hardRanked.flatMap((row) => {
      const problem = problemById.get(row.problemId)
      if (!problem) return []
      return [
        {
          problemDisplayId: problem.displayId,
          problemTitle: problem.title,
          className: row.className,
          total: row.total,
          accepted: row.accepted,
          failures: row.failures,
          userCount: row.userCount,
          acceptedUsers: row.acceptedUsers,
        },
      ]
    }),
    hasMore,
  } satisfies SubmissionLessons)
})
