import { randomBytes } from "node:crypto"

import {
  createFlowchartRequestSchema,
  type CreateFlowchartResponse,
  type FlowchartCurrent,
  type FlowchartDetail,
  type FlowchartList,
  type FlowchartListItem,
  type FlowchartStatistics,
  type FlowchartSubmission,
} from "@oj2/contract"
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, requireTeacher, type AppEnv } from "../auth/middleware"
import { config } from "../config"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { flowchartQueue } from "../queue"
import { getBooleanOption } from "../services/options"
import { consumeToken } from "../services/throttling"
import { buildWordFrequencies } from "../services/word-frequency"
import { todayStart } from "../time"
import {
  isAdminRole,
  matchedUsers,
  objectValue,
  queryInteger,
  rounded,
  stripClassPrefix,
} from "./helpers"

export const flowchartRoutes = new Hono<AppEnv>()

// AI 评分单独一个限流桶，与代码提交的 `throttling:user:<id>` 分开计数
function flowchartThrottleKey(userId: number) {
  return `flowchart:${userId}`
}

function canView(user: import("../auth/session").AuthUser, row: { userId: number }, problem: { createdById: number }) {
  return row.userId === user.id || isAdminRole(user) || problem.createdById === user.id
}

function flowchartData(
  flowchart: typeof schema.flowchartSubmission.$inferSelect,
  username: string,
) {
  return {
    id: flowchart.id,
    username,
    problemId: flowchart.problemId,
    mermaidCode: flowchart.mermaidCode,
    flowchartData: objectValue(flowchart.flowchartData),
    status: flowchart.status,
    createTime: flowchart.createTime,
    aiScore: flowchart.aiScore,
    aiGrade: flowchart.aiGrade,
    aiFeedback: flowchart.aiFeedback,
    aiSuggestions: flowchart.aiSuggestions,
    aiCriteriaDetails: objectValue(flowchart.aiCriteriaDetails),
    aiProvider: flowchart.aiProvider,
    aiModel: flowchart.aiModel,
    processingTime: flowchart.processingTime,
    evaluationTime: flowchart.evaluationTime,
  } satisfies FlowchartSubmission
}

flowchartRoutes.post("/flowcharts", requireAuth, async (c) => {
  const parsed = createFlowchartRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || JSON.stringify(parsed.data?.flowchartData ?? {}).length > 500 * 1024) {
    return failure(c, 400, "invalid-request", parsed.error?.issues[0]?.message ?? "Flowchart data is too large")
  }
  const [problem] = await db.select({ id: schema.problem.id, allow: schema.problem.allowFlowchart }).from(schema.problem)
    .where(eq(schema.problem.id, parsed.data.problemId)).limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!problem.allow) return failure(c, 400, "flowchart-not-allowed", "This problem does not allow flowchart submission")
  // 限流：每次提交都会触发一次外部 AI 调用，是和判题沙箱同级的有限资源。
  // 身份前缀单独开一个桶，**不能**直接用 user id —— 那是代码提交在用的桶，
  // 共用的话学生在机房连着交几次代码，流程图这边就会莫名其妙交不上去。
  const throttle = await consumeToken("user", flowchartThrottleKey(c.get("user")!.id))
  if (!throttle.allowed) {
    return failure(c, 429, "too-many-submissions", `Please wait ${Math.floor(throttle.wait)} seconds`)
  }
  const id = randomBytes(16).toString("hex")
  await db.insert(schema.flowchartSubmission).values({
    id,
    userId: c.get("user")!.id,
    problemId: problem.id,
    mermaidCode: parsed.data.mermaidCode,
    flowchartData: parsed.data.flowchartData,
    status: 0,
    createTime: new Date().toISOString(),
    aiScore: null,
    aiGrade: null,
    aiFeedback: null,
    aiSuggestions: null,
    aiCriteriaDetails: {},
    aiProvider: "deepseek",
    aiModel: config.aiModel,
    processingTime: null,
    evaluationTime: null,
  })
  try {
    await flowchartQueue.add("evaluate", { submissionId: id }, { jobId: id })
  } catch (error) {
    await db.update(schema.flowchartSubmission).set({ status: 3 }).where(eq(schema.flowchartSubmission.id, id))
    return failure(c, 502, "queue-unavailable", "Evaluation queue is unavailable")
  }
  return success(c, { submissionId: id, status: "pending" } satisfies CreateFlowchartResponse, 201)
})

/**
 * 题号 / 用户名筛选一律先解析成 `flowchart_submission` 自己的列，不靠 join 之后比
 * `problem._id` / `user.username`。同一套做法见 submission.ts 的
 * problemFilter / usernameFilter，这里是两个好处：
 *
 * - 列表的 count 因此**一个 join 都不用挂**。挂了就回不到最小索引上的 index-only
 *   scan，而这张表每行带 3KB 的 flowchart_data + 1.2KB 的 mermaid_code，堆页密度低，
 *   回表比 submission 那边贵。
 * - 筛条件落在驱动表上，规划器能走 flowchart_user_time_idx / flowchart_problem_time_idx，
 *   不必顺着时间索引倒扫再逐行 join 过滤。
 *
 * 查无此题 / 此人时留**恒假**条件 —— 少推一个 filter 就成了「不筛」，
 * 「查无此班」会变成「全站」。
 */
async function flowchartProblemFilter(displayId: string) {
  const problems = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(and(
      sql`lower(${schema.problem.displayId}) = lower(${displayId})`,
      // 流程图题都是公开题（快照里那 12 道 contest_id 全为空），
      // 比赛题的 _id 撞号是常态，不该被筛进来
      isNull(schema.problem.contestId),
    ))
  return problems.length
    ? inArray(schema.flowchartSubmission.problemId, problems.map((row) => row.id))
    : sql`false`
}

async function flowchartUserFilter(username: string) {
  const ids = (await matchedUsers(username)).map((row) => row.id)
  return ids.length ? inArray(schema.flowchartSubmission.userId, ids) : sql`false`
}

/**
 * 列表只取这几列。原来是 `select({ flowchart: 整行, problem: 整行 })`，把
 * mermaid_code、flowchart_data、ai_feedback、ai_suggestions、ai_criteria_details
 * 和**整张题目表**（description / 标准答案 / 标准流程图…）一起拉回来，而响应一个
 * 都用不到：生产快照实测流程图行均 4.9KB（p90 6.9KB）、题目行均 2.2KB，默认 10 行
 * 一页白拉 ~70KB，limit=250 时 1.7MB。
 *
 * 对齐 submission.ts 的 submissionListColumns —— 那边同样是手写白名单，
 * 刻意不取 code / info。
 */
const flowchartListColumns = {
  flowchart: {
    id: schema.flowchartSubmission.id,
    // showLink 判定要，序列化本身用不到
    userId: schema.flowchartSubmission.userId,
    status: schema.flowchartSubmission.status,
    createTime: schema.flowchartSubmission.createTime,
    aiScore: schema.flowchartSubmission.aiScore,
    aiGrade: schema.flowchartSubmission.aiGrade,
    aiProvider: schema.flowchartSubmission.aiProvider,
    aiModel: schema.flowchartSubmission.aiModel,
    processingTime: schema.flowchartSubmission.processingTime,
    evaluationTime: schema.flowchartSubmission.evaluationTime,
  },
  username: schema.user.username,
  problem: {
    displayId: schema.problem.displayId,
    title: schema.problem.title,
    // 同上，canView 要
    createdById: schema.problem.createdById,
  },
}

flowchartRoutes.get("/flowcharts", requireAuth, async (c) => {
  const user = c.get("user")!
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const displayId = c.req.query("problemId")?.trim()
  const username = c.req.query("username")?.trim()
  const grade = c.req.query("grade")
  // 与代码提交列表同一套口径（submission.ts 的 GET /submissions）：关掉
  // submission_list_show_all 时非管理员看不到列表。流程图这边一直漏了这道门，
  // 学生把语言切成「流程图」、用户名随便填一个字就能翻出全班的 AI 评分。
  if (!(await getBooleanOption("submission_list_show_all", true)) && !isAdminRole(user)) {
    return success(c, { results: [], total: 0 } satisfies FlowchartList)
  }
  // 「只看自己」盖过用户名；普通学生不填用户名时也只看自己
  const onlyMyself = c.req.query("myself") === "1" || (!username && user.adminType === "Regular User")
  const filters: Array<SQL | undefined> = []
  filters.push(...await Promise.all([
    displayId ? flowchartProblemFilter(displayId) : undefined,
    !onlyMyself && username ? flowchartUserFilter(username) : undefined,
  ]))
  if (onlyMyself) filters.push(eq(schema.flowchartSubmission.userId, user.id))
  if (c.req.query("today") === "1") filters.push(sql`${schema.flowchartSubmission.createTime} >= ${todayStart()}`)
  if (["S", "A", "B", "C"].includes(grade ?? "")) filters.push(eq(schema.flowchartSubmission.aiGrade, grade!))
  const where = and(...filters)
  const [totalRows, rows] = await Promise.all([
    // 筛条件已经全落在 flowchart_submission 自己的列上，count 不挂任何 join
    db.select({ value: count() }).from(schema.flowchartSubmission).where(where),
    db.select(flowchartListColumns)
      .from(schema.flowchartSubmission)
      .innerJoin(schema.user, eq(schema.flowchartSubmission.userId, schema.user.id))
      .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
      .where(where)
      .orderBy(desc(schema.flowchartSubmission.createTime)).limit(limit).offset(offset),
  ])
  return success(c, {
    results: rows.map(({ flowchart, username, problem }) => ({
      id: flowchart.id,
      username,
      problem: problem.displayId,
      problemTitle: problem.title,
      status: flowchart.status,
      createTime: flowchart.createTime,
      aiScore: flowchart.aiScore,
      aiGrade: flowchart.aiGrade,
      aiProvider: flowchart.aiProvider,
      aiModel: flowchart.aiModel,
      processingTime: flowchart.processingTime,
      evaluationTime: flowchart.evaluationTime,
      showLink: canView(user, flowchart, problem),
    } satisfies FlowchartListItem)),
    total: totalRows[0]?.value ?? 0,
  } satisfies FlowchartList)
})

const FLOWCHART_COMPLETED = 2

/**
 * 词云取的提交条数上限，同时也是分词的文本条数上限。
 *
 * 数值统计（总数、均分、等级分布、各项平均分、完成人数）按整个时间窗**精确**计算，
 * 但那几项现在全是 SQL 聚合，代价不随窗口里的行数走。**不能采样** —— 采了之后老师
 * 看到的完成率和均分就是错的，而且从界面上看不出来。
 *
 * 会随数据量线性变重的只剩词云：每条 feedback / suggestions / comment 都要走一遍
 * jieba，而前端的「全部时段」是不带 start 的（FlowchartStatisticsPanel.vue 那个
 * `duration === "all"`），攒一学年就得把所有评语重新 cut 一遍。词云是辅助性的，
 * 看的是高频问题，取最近这些条足够。
 *
 * 这里**同时**卡了两道：SQL 侧 `order by create_time desc limit N` 只取最近 N 条提交，
 * JS 侧 pushText 再卡 N 条文本。生产快照实测一条提交出 5.97 段文本（几项 comment +
 * feedback + suggestions，最少的一条也有 1 段），所以先到的一直是文本那道闸——3000 段
 * 在 500 条出头就满了，行数那道只是兜底：真遇到一批评语全空的提交，词云少看几条，
 * 可以接受。原来只有 JS 那道，行早就整批拉回内存了。
 */
const WORDCLOUD_TEXT_LIMIT = 3000

flowchartRoutes.get("/flowcharts/statistics", requireTeacher, async (c) => {
  const end = c.req.query("end")?.trim()
  if (!end) return failure(c, 400, "invalid-request", "end is required")
  const start = c.req.query("start")?.trim()

  const filters: Array<SQL | undefined> = [
    eq(schema.flowchartSubmission.status, FLOWCHART_COMPLETED),
    sql`${schema.flowchartSubmission.createTime} <= ${end}`,
  ]
  if (start) filters.push(sql`${schema.flowchartSubmission.createTime} >= ${start}`)

  const displayId = c.req.query("problemId")?.trim()
  if (displayId) {
    const [problem] = await db
      .select({ id: schema.problem.id })
      .from(schema.problem)
      .where(and(
        sql`lower(${schema.problem.displayId}) = lower(${displayId})`,
        isNull(schema.problem.contestId),
        eq(schema.problem.visible, true),
      ))
      .limit(1)
    if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
    filters.push(eq(schema.flowchartSubmission.problemId, problem.id))
  }

  const username = c.req.query("username")?.trim()
  // 用户名先解析成账号，再拿 user_id 去筛 —— 理由同代码提交的统计接口
  // （submission.ts 的 GET /submissions/statistics），顺带让下面这几条一个 join 都不用挂
  const matched = username ? await matchedUsers(username) : []
  if (username) {
    const ids = matched.map((row) => row.id)
    // 一个账号都没匹配上时得留个恒假条件，否则「查无此班」变成「全站统计」
    filters.push(ids.length ? inArray(schema.flowchartSubmission.userId, ids) : sql`false`)
  }
  const where = and(...filters)
  // 花名册：只有指定了用户名才谈得上「班级人数」，不指定时分母无意义。
  // 未禁用的普通用户才进分母，教师和管理员不算
  const roster = username
    ? matched.filter((row) => !row.isDisabled && row.adminType === "Regular User")
    : []

  /**
   * 五条查询，每条的代价都和窗口里的行数脱钩（词云那条卡了 limit）。
   *
   * 原来是**一条**不带 limit 的 `select(username, score, grade, criteria, feedback,
   * suggestions) order by create_time desc`，把整个时间窗的行拉进内存再用 JS 算 ——
   * 词云的 3000 条上限是在 JS 里截的，行早就全回来了。备份实测每行的 AI 文本约 366B
   * （criteria 255 + suggestions 64 + feedback 47），现在 2134 条无感，5 万条就是一次
   * 点击 18MB，而老师是开着面板反复切时段、切班的。
   */
  const [[totals], gradeRows, criteriaRows, textRows, submittedRows] = await Promise.all([
    db
      .select({
        total: count(),
        /**
         * 均分拆成 sum / count 两项，不直接用 `avg()`：分母是**有分数的条数**而不是
         * 总条数（对齐 Django 的 Avg()，它跳过 NULL），拆开之后这个口径在代码里是
         * 写明的，也省掉 avg() 在空集上回 NULL 还要兜底。
         */
        scoreSum: sql<number>`coalesce(sum(${schema.flowchartSubmission.aiScore}), 0)`.mapWith(Number),
        scoreCount: sql<number>`count(${schema.flowchartSubmission.aiScore})::int`.mapWith(Number),
        // 完成人数。user_id 和 username 一一对应，按哪个 distinct 都一样，
        // 按 user_id 就不必 join user
        completedCount: sql<number>`count(distinct ${schema.flowchartSubmission.userId})::int`.mapWith(Number),
      })
      .from(schema.flowchartSubmission)
      .where(where),
    db
      .select({ grade: schema.flowchartSubmission.aiGrade, n: count() })
      .from(schema.flowchartSubmission)
      .where(where)
      .groupBy(schema.flowchartSubmission.aiGrade),
    /**
     * 各项**平均分**。`ai_criteria_details` 是 `{ 项名: { score, max, comment } }`，
     * 用 jsonb_each 展开之后按项名分组。分数不是数字的项整项跳过，和原来 JS 那句
     * `typeof detail.score !== "number"` 的 continue 一致。
     *
     * **那道 `jsonb_typeof(...) = 'object'` 的闸不能省，而且要写在 jsonb_each 的参数里。**
     * 不能省：撞上标量（历史脏数据）jsonb_each 直接抛错，整个面板 500 ——
     * 拿 `'5'::jsonb` 和 `'[1,2]'::jsonb` 各插一行验过。
     *
     * 写在哪儿则纯是规划器的脸色：挪进 where 当基表过滤条件时，53350 行的探针上
     * 实测 180ms → 360ms，因为计划从「并行 Partial HashAggregate」换成了「串行
     * GroupAggregate + 21 万行外部归并排序、落盘 26MB」。两种写法都正确，选快的那个。
     *
     * 每项的**满分**不在这里取，见下面 criteriaMax 的注释：在这条 SQL 里按
     * create_time 取「最新那条」要给 21 万行（4 项 × 5 万条）排序，同一个探针上
     * 实测 254ms → 842ms，而满分本来就是几个常数。
     */
    db.execute<{ key: string; avg: number }>(sql`
      select e.key as key, avg((e.value->>'score')::double precision) as avg
      from ${schema.flowchartSubmission}
      cross join lateral jsonb_each(
        case when jsonb_typeof(${schema.flowchartSubmission.aiCriteriaDetails}) = 'object'
             then ${schema.flowchartSubmission.aiCriteriaDetails}
             else '{}'::jsonb end
      ) e
      where ${where} and jsonb_typeof(e.value->'score') = 'number'
      group by e.key
    `),
    // 词云的原料。只有这条要读大列，所以只有它按时间倒序取最近的 N 条
    db
      .select({
        criteria: schema.flowchartSubmission.aiCriteriaDetails,
        feedback: schema.flowchartSubmission.aiFeedback,
        suggestions: schema.flowchartSubmission.aiSuggestions,
      })
      .from(schema.flowchartSubmission)
      .where(where)
      .orderBy(desc(schema.flowchartSubmission.createTime))
      .limit(WORDCLOUD_TEXT_LIMIT),
    // 「谁没做」只在有花名册时算得出来，行数也就一个班
    roster.length
      ? db
          .selectDistinct({ userId: schema.flowchartSubmission.userId })
          .from(schema.flowchartSubmission)
          .where(where)
      : [],
  ])

  if (!totals || totals.total === 0) {
    return success(c, {
      totalCount: 0,
      avgScore: 0,
      gradeDistribution: {},
      criteriaAverages: {},
      personCount: roster.length,
      completedCount: 0,
      wordFrequencies: [],
      // 一条提交都没有时，花名册上的人**全都**是「没做」—— 原来这里写死空数组，
      // 于是一节课刚开始、最该点名的时候，教师面板反而一个名字都不给
      dataUnaccepted: roster.map((row) => ({
        username: row.username,
        realName: stripClassPrefix(row.username, row.className),
      })),
    } satisfies FlowchartStatistics)
  }

  const gradeDistribution: Record<string, number> = {}
  for (const row of gradeRows) {
    // 旧后端用 values_list("ai_grade") 分组，null 也会成为一个桶；这里保持同样的口径。
    // null 和空串会分成两组，合并到同一个桶里
    const grade = row.grade ?? ""
    gradeDistribution[grade] = (gradeDistribution[grade] ?? 0) + row.n
  }

  /**
   * 词云原料和每项满分都从同一批行里取 —— 这批行本来就要读（见下面的 textRows），
   * 白嫖一遍，不额外查库。
   *
   * 满分的口径是「按 create_time 倒序，某项**第一次**出现时写的那个 max，不是数字就
   * 退回 100」，和原来逐行遍历时那句 `if (bucket) ... else set(max)` 完全一致，只是
   * 遍历范围从整个时间窗收成最近 WORDCLOUD_TEXT_LIMIT 条。满分是评分标准里的常数
   * （完整性 30、逻辑正确性 40…），几万条里换一次都算多；真出现一项**只**在更早的
   * 行里有过，它的平均分照常出（那是 SQL 全窗口算的），满分退回 100。
   */
  const criteriaMax = new Map<string, number>()
  const texts: string[] = []
  const pushText = (value: string) => {
    if (texts.length < WORDCLOUD_TEXT_LIMIT) texts.push(value)
  }
  for (const row of textRows) {
    for (const [key, value] of Object.entries(objectValue(row.criteria))) {
      const detail = objectValue(value)
      // 和上面那条聚合同一道闸：分数不是数字的项当没配过，满分和评语也都不收
      if (typeof detail.score !== "number") continue
      if (!criteriaMax.has(key)) {
        criteriaMax.set(key, typeof detail.max === "number" ? detail.max : 100)
      }
      if (typeof detail.comment === "string" && detail.comment) pushText(detail.comment)
    }
    if (row.feedback) pushText(row.feedback)
    if (row.suggestions) pushText(row.suggestions)
  }

  const criteriaAverages: Record<string, { avg: number; max: number }> = {}
  for (const row of criteriaRows) {
    criteriaAverages[row.key] = { avg: rounded(row.avg, 1), max: criteriaMax.get(row.key) ?? 100 }
  }

  const submitted = new Set(submittedRows.map((row) => row.userId))
  return success(c, {
    totalCount: totals.total,
    avgScore: totals.scoreCount ? rounded(totals.scoreSum / totals.scoreCount, 1) : 0,
    gradeDistribution,
    criteriaAverages,
    personCount: roster.length,
    completedCount: totals.completedCount,
    wordFrequencies: await buildWordFrequencies(texts),
    dataUnaccepted: roster
      .filter((row) => !submitted.has(row.id))
      .map((row) => ({
        username: row.username,
        realName: stripClassPrefix(row.username, row.className),
      })),
  } satisfies FlowchartStatistics)
})

flowchartRoutes.get("/flowcharts/:id", requireAuth, async (c) => {
  const [row] = await db.select({ flowchart: schema.flowchartSubmission, username: schema.user.username, problem: schema.problem })
    .from(schema.flowchartSubmission).innerJoin(schema.user, eq(schema.flowchartSubmission.userId, schema.user.id))
    .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
    .where(eq(schema.flowchartSubmission.id, c.req.param("id"))).limit(1)
  if (!row || !canView(c.get("user")!, row.flowchart, row.problem)) return failure(c, 404, "flowchart-not-found", "Submission does not exist")
  return success(c, flowchartData(row.flowchart, row.username))
})

flowchartRoutes.post("/flowcharts/:id/retry", requireAuth, async (c) => {
  const user = c.get("user")!
  const [row] = await db.select({ flowchart: schema.flowchartSubmission, problem: schema.problem }).from(schema.flowchartSubmission)
    .innerJoin(schema.problem, eq(schema.flowchartSubmission.problemId, schema.problem.id))
    .where(eq(schema.flowchartSubmission.id, c.req.param("id"))).limit(1)
  if (!row || !canView(user, row.flowchart, row.problem)) return failure(c, 404, "flowchart-not-found", "Submission does not exist")
  if (![2, 3].includes(row.flowchart.status)) return failure(c, 409, "retry-not-allowed", "Submission is not in a state that allows retry")
  // canView 允许本人重试自己的提交，不限流的话学生可以反复点着刷 AI 调用。
  // 教师放行：重新判题是他们的日常操作，成批点几十行是正常用法
  if (!isAdminRole(user)) {
    const throttle = await consumeToken("user", flowchartThrottleKey(user.id))
    if (!throttle.allowed) {
      return failure(c, 429, "too-many-submissions", `Please wait ${Math.floor(throttle.wait)} seconds`)
    }
  }
  await db.update(schema.flowchartSubmission).set({
    status: 0, aiScore: null, aiGrade: null, aiFeedback: null, aiSuggestions: null,
    aiCriteriaDetails: {}, processingTime: null, evaluationTime: null,
  }).where(eq(schema.flowchartSubmission.id, row.flowchart.id))
  try {
    // jobId 必须**正好三段**：bullmq 对含 `:` 的自定义 id 有一条兼容老的可重复
    // 任务的校验（job.js 的 `split(':').length !== 3`），两段会直接抛
    // `Custom Id cannot contain :`。原来写的是 `${id}:${时间戳}`，于是这个接口
    // 从来没成功过 —— 而清空评分在入队之前，每点一次就把原来的分数永久清掉、
    // 提交卡在 PENDING 且没有任何任务会来救它。
    await flowchartQueue.add(
      "evaluate",
      { submissionId: row.flowchart.id },
      { jobId: `${row.flowchart.id}:retry:${Date.now()}` },
    )
  } catch (error) {
    // 入队失败就落 FAILED，别把提交丢在 PENDING 上 —— 和 POST /flowcharts 同一处理
    await db.update(schema.flowchartSubmission).set({ status: 3 }).where(eq(schema.flowchartSubmission.id, row.flowchart.id))
    return failure(c, 502, "queue-unavailable", "Evaluation queue is unavailable")
  }
  return success(c, { submissionId: row.flowchart.id, status: "pending" } satisfies CreateFlowchartResponse)
})

flowchartRoutes.get("/problems/:id/flowchart/current", requireAuth, async (c) => {
  const problemId = queryInteger(c.req.param("id"), 0, { min: 1 })
  const rows = await db.select({ score: schema.flowchartSubmission.aiScore, grade: schema.flowchartSubmission.aiGrade })
    .from(schema.flowchartSubmission).where(and(eq(schema.flowchartSubmission.userId, c.get("user")!.id), eq(schema.flowchartSubmission.problemId, problemId), eq(schema.flowchartSubmission.status, 2)))
    .orderBy(desc(schema.flowchartSubmission.createTime))
  return success(c, { count: rows.length, score: rows[0]?.score ?? 0, grade: rows[0]?.grade ?? "" } satisfies FlowchartCurrent)
})

flowchartRoutes.get("/problems/:id/flowchart/history", requireAuth, async (c) => {
  const problemId = queryInteger(c.req.param("id"), 0, { min: 1 })
  const page = queryInteger(c.req.query("page"), 0, { min: 0 })
  const rows = await db.select({ flowchart: schema.flowchartSubmission, username: schema.user.username })
    .from(schema.flowchartSubmission).innerJoin(schema.user, eq(schema.flowchartSubmission.userId, schema.user.id))
    .where(and(eq(schema.flowchartSubmission.userId, c.get("user")!.id), eq(schema.flowchartSubmission.problemId, problemId), eq(schema.flowchartSubmission.status, 2)))
    .orderBy(asc(schema.flowchartSubmission.createTime))
  const selected = page === 0 ? rows.at(-1) : rows[page - 1]
  if (page > rows.length) return failure(c, 400, "page-out-of-range", "Page out of range")
  return success(c, { submission: selected ? flowchartData(selected.flowchart, selected.username) : null, count: rows.length } satisfies FlowchartDetail)
})
