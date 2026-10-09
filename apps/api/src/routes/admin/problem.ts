import {
  addContestProblemRequestSchema,
  reorderContestProblemsRequestSchema,
  astCheckRequestSchema,
  generateTestInputsRequestSchema,
  isSqlProblem,
  TEST_CASE_EDIT_MAX_CASES,
  TEST_CASE_EDIT_MAX_FILE_BYTES,
  createProblemRequestSchema,
  generateSqlTestCaseRequestSchema,
  makeProblemPublicRequestSchema,
  sqlPreviewRequestSchema,
  updateProblemRequestSchema,
  type AdminProblem,
  type AdminProblemList,
  type AdminProblemListItem,
  type AstCheckResponse,
  type AstRules,
  type GenerateTestInputsResponse,
  type GenerateSqlTestCaseResponse,
  type SqlConfig,
  type SqlDisplay,
  type SqlTestCaseScript,
  type TestCaseFiles,
  type UploadTestCaseResponse,
} from "@oj2/contract"
import { and, count, desc, eq, ilike, inArray, isNull, ne, not, or, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireProblemPermission, type AppEnv } from "../../auth/middleware"
import type { AuthUser } from "../../auth/session"
import { db, schema, type DbOrTx } from "../../db"
import { failure, parseBody, success } from "../../http"
import { astRulesError, checkAst, describeAstRule, pickAstRules } from "../../judge/ast"
import { buildSqlDisplay } from "../../judge/sql"
import { completeChat } from "../../services/ai"
import { plainText } from "../../services/hint-diagnosis"
import { contestStatus } from "../../services/contest"
import {
  packTestCaseZip,
  processTestCaseZip,
  readInfo,
  readSqlScripts,
  readTestCaseFiles,
  TestCaseError,
} from "../../services/test-case"
import { config } from "../../config"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { getTopReactions } from "../../services/reaction"
import { asRecord, queryInteger, sampleUser } from "../helpers"

export const adminProblemRoutes = new Hono<AppEnv>()

type ProblemRow = typeof schema.problem.$inferSelect

function canManageAll(user: AuthUser) {
  return user.adminType === "Super Admin" || user.problemPermission === "All"
}

/**
 * 题目归属判断。比赛题看**比赛**的创建者，公开题看题目自己的创建者 ——
 * 对齐旧后端：`ensure_created_by(problem.contest, user)` vs `ensure_created_by(problem, user)`。
 * 一道比赛题的 created_by 可能是克隆时的操作人，跟谁有权改它没关系。
 */
export async function canEdit(
  user: AuthUser,
  problem: Pick<ProblemRow, "contestId" | "createdById">,
) {
  if (user.adminType === "Super Admin") return true
  if (problem.contestId === null) {
    return canManageAll(user) || problem.createdById === user.id
  }
  const [contest] = await db
    .select({ createdById: schema.contest.createdById })
    .from(schema.contest)
    .where(eq(schema.contest.id, problem.contestId))
    .limit(1)
  return Boolean(contest && contest.createdById === user.id)
}

async function tagNames(problemId: number) {
  return (await tagNamesFor([problemId])).get(problemId) ?? []
}

/** 批量版：列表接口一定要走这个，按行调 tagNames 就是 N+1 */
async function tagNamesFor(problemIds: number[]) {
  const result = new Map<number, string[]>()
  if (problemIds.length === 0) return result
  const rows = await db
    .select({
      problemId: schema.problemTags.problemId,
      name: schema.problemTag.name,
    })
    .from(schema.problemTags)
    .innerJoin(schema.problemTag, eq(schema.problemTags.problemtagId, schema.problemTag.id))
    .where(inArray(schema.problemTags.problemId, problemIds))
  for (const row of rows)
    result.set(row.problemId, [...(result.get(row.problemId) ?? []), row.name])
  return result
}

/**
 * 把一批标签名去空格、去重（大小写不敏感），保留每个名字第一次出现时的原始大小写。
 * 解析和批量打标签两条路都用它，口径对齐旧 resolve_tags。
 */
export function normalizeTagNames(names: string[]) {
  const wanted: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    wanted.push(name)
  }
  return wanted
}

/**
 * 一条 `lower(name) in (...)` 把已有标签全查回来，按小写名建 Map。
 * 以前是每个名字一条 SELECT，一次改十个标签就是十次往返。
 */
export async function findTagsByName(tx: DbOrTx, names: string[]) {
  const map = new Map<string, number>()
  if (names.length === 0) return map
  const rows = await tx
    .select({ id: schema.problemTag.id, name: schema.problemTag.name })
    .from(schema.problemTag)
    .where(
      inArray(
        sql`lower(${schema.problemTag.name})`,
        names.map((name) => name.toLowerCase()),
      ),
    )
  for (const row of rows) map.set(row.name.toLowerCase(), row.id)
  return map
}

/** 把标签名解析成 id：去空格、大小写不敏感复用已有标签，没有才新建。对齐旧 resolve_tags */
async function resolveTags(tx: DbOrTx, names: string[]) {
  const wanted = normalizeTagNames(names)
  if (wanted.length === 0) return []
  const existing = await findTagsByName(tx, wanted)
  const missing = wanted.filter((name) => !existing.has(name.toLowerCase()))
  if (missing.length) {
    const created = await tx
      .insert(schema.problemTag)
      .values(missing.map((name) => ({ name })))
      .returning({ id: schema.problemTag.id, name: schema.problemTag.name })
    for (const row of created) existing.set(row.name.toLowerCase(), row.id)
  }
  return wanted.map((name) => existing.get(name.toLowerCase())!).filter((id) => id !== undefined)
}

async function setTags(tx: DbOrTx, problemId: number, names: string[]) {
  const ids = await resolveTags(tx, names)
  await tx.delete(schema.problemTags).where(eq(schema.problemTags.problemId, problemId))
  if (ids.length) {
    await tx
      .insert(schema.problemTags)
      .values(ids.map((problemtagId) => ({ problemId, problemtagId })))
  }
}

async function serialize(row: ProblemRow) {
  const [[creator], tags] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        realName: schema.userProfile.realName,
      })
      .from(schema.user)
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(eq(schema.user.id, row.createdById))
      .limit(1),
    tagNames(row.id),
  ])
  return {
    id: row.id,
    _id: row.displayId,
    title: row.title,
    description: row.description,
    inputDescription: row.inputDescription,
    outputDescription: row.outputDescription,
    samples: Array.isArray(row.samples) ? row.samples : [],
    testCaseId: row.testCaseId,
    testCaseScore: Array.isArray(row.testCaseScore) ? row.testCaseScore : [],
    hint: row.hint,
    languages: row.languages,
    template: row.template,
    createTime: row.createTime,
    lastUpdateTime: row.lastUpdateTime,
    timeLimit: row.timeLimit,
    memoryLimit: row.memoryLimit,
    visible: row.visible,
    difficulty: row.difficulty,
    source: row.source,
    submissionNumber: row.submissionNumber,
    acceptedNumber: row.acceptedNumber,
    statisticInfo: asRecord(row.statisticInfo),
    contestId: row.contestId,
    createdBy: sampleUser(creator ?? { id: row.createdById, username: "" }, creator?.realName),
    isPublic: row.isPublic,
    tags,
    allowFlowchart: row.allowFlowchart,
    showFlowchart: row.showFlowchart,
    mermaidCode: row.mermaidCode,
    flowchartHint: row.flowchartHint,
    astRules: row.astRules,
    answers: Array.isArray(row.answers) ? row.answers : [],
    prompt: row.prompt,
    sqlConfig: row.sqlConfig,
    sqlDisplay: row.sqlDisplay,
  } satisfies AdminProblem
}

/** 公共校验，对齐旧 `ProblemBase.common_checks` */
function commonChecks(data: {
  languages: string[]
  inputDescription: string
  outputDescription: string
  samples: unknown[]
  sqlConfig: SqlConfig | null
  answers: Record<string, unknown>[]
  astRules: AstRules | null
}): { error: string } | { sql: boolean } {
  const astError = astRulesError(pickAstRules(data.astRules, data.languages))
  if (astError) return { error: astError }
  if (isSqlProblem(data)) {
    if (data.languages.length !== 1)
      return { error: "SQL problem cannot be mixed with other languages" }
    if (!data.sqlConfig) return { error: "SQL problem requires sql_config" }
    const hasAnswer = data.answers.some(
      (item) => item.language === "SQL" && typeof item.code === "string" && item.code.trim(),
    )
    if (!hasAnswer) return { error: "SQL problem requires a SQL reference answer" }
    return { sql: true }
  }
  if (!data.inputDescription || !data.outputDescription) {
    return { error: "Input and output description are required" }
  }
  if (data.samples.length === 0) return { error: "Samples are required" }
  return { sql: false }
}

/**
 * SQL 题保存时生成题目页展示数据（数据表 + 期望结果）。
 * 对齐旧 `problem/utils.py:generate_sql_display`：取**测试点 1** 的初始化脚本 + 标准答案跑一遍。
 * 失败一律拦下不让保存 —— 展示数据直接决定学生看到的表结构与期望结果，宁可不保存也不能存错的。
 */
async function generateSqlDisplay(
  testCaseId: string,
  answers: Record<string, unknown>[],
  sqlConfig: SqlConfig,
): Promise<{ error: string } | { display: SqlDisplay }> {
  const info = await readInfo(testCaseId)
  if (!info) return { error: "测试点信息读取失败，请重新上传测试点" }
  if (!info.sql) return { error: "测试点不是 SQL 类型，请重新上传 SQL 测试点压缩包" }
  const keys = Object.keys(info.test_cases ?? {}).sort((a, b) => Number(a) - Number(b))
  if (keys.length === 0) return { error: "题目没有任何测试点" }
  const inputName = info.test_cases![keys[0]!]?.input_name
  if (!inputName) return { error: "测试点信息损坏，请重新上传测试点" }
  let initSql: string
  try {
    initSql = await readFile(resolve(config.testCaseDirectory, testCaseId, inputName), "utf8")
  } catch {
    return { error: `测试点脚本 ${inputName} 读取失败` }
  }
  const refSql = answers.find(
    (item) => item.language === "SQL" && typeof item.code === "string" && item.code.trim(),
  )?.code
  if (typeof refSql !== "string") return { error: "题目缺少 SQL 标准答案" }
  const outcome = await buildSqlDisplay(initSql, refSql, sqlConfig.mode)
  if (!outcome.ok) return { error: `SQL 展示数据生成失败: ${outcome.message}` }
  return { display: outcome.value }
}

function problemValues(data: ReturnType<typeof createProblemRequestSchema.parse>, isSql: boolean) {
  return {
    displayId: data._id,
    title: data.title,
    description: data.description,
    inputDescription: data.inputDescription,
    outputDescription: data.outputDescription,
    samples: data.samples,
    testCaseId: data.testCaseId,
    testCaseScore: data.testCaseScore,
    hint: data.hint,
    languages: data.languages,
    template: data.template,
    timeLimit: data.timeLimit,
    memoryLimit: data.memoryLimit,
    visible: data.visible,
    difficulty: data.difficulty,
    source: data.source,
    allowFlowchart: data.allowFlowchart,
    showFlowchart: data.showFlowchart,
    mermaidCode: data.mermaidCode,
    flowchartHint: data.flowchartHint,
    astRules: pickAstRules(data.astRules, data.languages),
    answers: data.answers,
    prompt: data.prompt,
    // 防脏数据：非 SQL 题不应携带 SQL 配置，对齐旧 common_checks
    sqlConfig: isSql ? data.sqlConfig : null,
  }
}

type ProblemInput = ReturnType<typeof createProblemRequestSchema.parse>

/**
 * 保存前的全部校验：公共校验 + SQL 题的展示数据。新建公开题、新建比赛题、编辑题目
 * 三条路径共用 —— 原来各抄一份，比赛题那份还把算好的 sqlDisplay 丢了（见 insertProblem）。
 *
 * SQL 题每次保存都重算展示数据：测试点或标准答案可能刚改过，留着旧的就会和判题结果对不上。
 */
async function validateProblem(
  data: ProblemInput,
): Promise<{ error: string } | { sql: boolean; sqlDisplay: SqlDisplay | null }> {
  const checked = commonChecks(data)
  if ("error" in checked) return checked
  if (!checked.sql) return { sql: false, sqlDisplay: null }
  const built = await generateSqlDisplay(data.testCaseId, data.answers, data.sqlConfig!)
  if ("error" in built) return built
  return { sql: true, sqlDisplay: built.display }
}

/** 新建一道题（公开题 contestId 为 null）连同标签，一个事务 */
async function insertProblem(
  data: ProblemInput,
  validated: { sql: boolean; sqlDisplay: SqlDisplay | null },
  owner: { contestId: number | null; createdById: number },
) {
  const now = new Date().toISOString()
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.problem)
      .values({
        ...problemValues(data, validated.sql),
        ...owner,
        createTime: now,
        lastUpdateTime: now,
        submissionNumber: 0,
        acceptedNumber: 0,
        statisticInfo: {},
        isPublic: false,
        // 比赛题原来这里写死 null，结果比赛里的 SQL 题打开后看不到示例数据表和期望结果
        sqlDisplay: validated.sqlDisplay,
      })
      .returning()
    await setTags(tx, row!.id, data.tags)
    return row!
  })
}

/**
 * 把一道已有的题复制一份（连同标签），统计清零。比赛题转公开、从公开题库拉进比赛
 * 都是这个动作，只是落到哪、可见性怎么设不同，由 `overrides` 给。
 */
async function copyProblem(
  tx: DbOrTx,
  source: ProblemRow,
  overrides: Pick<
    typeof schema.problem.$inferInsert,
    "contestId" | "displayId" | "visible" | "isPublic"
  >,
) {
  const now = new Date().toISOString()
  const { id: _old, ...rest } = source
  const [copy] = await tx
    .insert(schema.problem)
    .values({
      ...rest,
      ...overrides,
      submissionNumber: 0,
      acceptedNumber: 0,
      statisticInfo: {},
      createTime: now,
      lastUpdateTime: now,
    })
    .returning()
  const tags = await tx
    .select({ tagId: schema.problemTags.problemtagId })
    .from(schema.problemTags)
    .where(eq(schema.problemTags.problemId, source.id))
  if (tags.length) {
    await tx
      .insert(schema.problemTags)
      .values(tags.map((tag) => ({ problemId: copy!.id, problemtagId: tag.tagId })))
  }
  return copy!
}

// ---------------------------------------------------------------- 公开题目

adminProblemRoutes.get("/problems", requireProblemPermission, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const user = c.get("user")!
  const filters = [isNull(schema.problem.contestId)]
  // library=1 是比赛的「从题库中选择」：要列的是 from-public 实际放行的范围 —— 所有可见的
  // 公开题，加上自己能改的。只按 created_by 过滤的话，「仅管理自己创建」的老师一道题都看不到
  const library = c.req.query("library") === "1"
  if (!canManageAll(user)) {
    const own = eq(schema.problem.createdById, user.id)
    filters.push(library ? or(eq(schema.problem.visible, true), own)! : own)
  }
  const author = c.req.query("author")?.trim()
  const keyword = c.req.query("keyword")?.trim()
  const tagId = c.req.query("tagId")?.trim()
  // 题型：sql = SQL 题，code = 编程题（C / C++ / Python）
  const kind = c.req.query("kind")
  const sqlOnly = sql`${schema.problem.languages} @> '["SQL"]'::jsonb`
  if (kind === "sql") filters.push(sqlOnly)
  else if (kind === "code") filters.push(not(sqlOnly))
  if (author) filters.push(eq(schema.user.username, author))
  if (keyword) {
    filters.push(
      or(
        ilike(schema.problem.title, `%${keyword}%`),
        ilike(schema.problem.displayId, `%${keyword}%`),
      )!,
    )
  }
  if (tagId) {
    filters.push(
      inArray(
        schema.problem.id,
        db
          .select({ id: schema.problemTags.problemId })
          .from(schema.problemTags)
          .where(eq(schema.problemTags.problemtagId, Number(tagId))),
      ),
    )
  }
  const where = and(...filters)
  const [totalRow, rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.problem)
      .innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
      .where(where),
    db
      .select({
        problem: schema.problem,
        user: schema.user,
        realName: schema.userProfile.realName,
      })
      .from(schema.problem)
      .innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(where)
      .orderBy(desc(schema.problem.createTime))
      .limit(limit)
      .offset(offset),
  ])
  // 只有公开题列表下发最高票评价，比赛题列表不下发 —— 与旧后端一致
  const problemIds = rows.map(({ problem }) => problem.id)
  const [topReactions, tags] = await Promise.all([
    getTopReactions(problemIds),
    tagNamesFor(problemIds),
  ])
  return success(c, {
    results: rows.map(
      ({ problem, user: creator, realName }) =>
        ({
          id: problem.id,
          _id: problem.displayId,
          title: problem.title,
          createdBy: sampleUser(creator, realName),
          visible: problem.visible,
          createTime: problem.createTime,
          difficulty: problem.difficulty,
          tags: tags.get(problem.id) ?? [],
          isSql: isSqlProblem(problem),
          hasAstRules: problem.astRules !== null,
          allowFlowchart: problem.allowFlowchart,
          showFlowchart: problem.showFlowchart,
          topReaction: topReactions.get(problem.id) ?? null,
        }) satisfies AdminProblemListItem,
    ),
    total: totalRow[0]?.value ?? 0,
  } satisfies AdminProblemList)
})

adminProblemRoutes.get("/problems/:id", requireProblemPermission, async (c) => {
  const [row] = await db
    .select()
    .from(schema.problem)
    .where(eq(schema.problem.id, queryInteger(c.req.param("id"), 0, { min: 1 })))
    .limit(1)
  if (!row) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!(await canEdit(c.get("user")!, row))) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }
  return success(c, await serialize(row))
})

adminProblemRoutes.post("/problems", requireProblemPermission, async (c) => {
  const parsed = await parseBody(c, createProblemRequestSchema)
  if (!parsed.success) return parsed.response
  const validated = await validateProblem(parsed.data)
  if ("error" in validated) return failure(c, 400, "invalid-problem", validated.error)

  const [duplicate] = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(and(eq(schema.problem.displayId, parsed.data._id), isNull(schema.problem.contestId)))
    .limit(1)
  if (duplicate) return failure(c, 409, "display-id-exists", "Display ID already exists")

  const created = await insertProblem(parsed.data, validated, {
    contestId: null,
    createdById: c.get("user")!.id,
  })
  return success(c, await serialize(created), 201)
})

adminProblemRoutes.put("/problems/:id", requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = await parseBody(c, updateProblemRequestSchema)
  if (!parsed.success) return parsed.response
  const [existing] = await db
    .select()
    .from(schema.problem)
    .where(eq(schema.problem.id, id))
    .limit(1)
  if (!existing) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!(await canEdit(c.get("user")!, existing))) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }
  const validated = await validateProblem(parsed.data)
  if ("error" in validated) return failure(c, 400, "invalid-problem", validated.error)

  // 题号唯一性的作用域跟着题目走：公开题在全部公开题里唯一，比赛题在本场比赛内唯一
  const [duplicate] = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(
      and(
        eq(schema.problem.displayId, parsed.data._id),
        existing.contestId === null
          ? isNull(schema.problem.contestId)
          : eq(schema.problem.contestId, existing.contestId),
        ne(schema.problem.id, id),
      ),
    )
    .limit(1)
  if (duplicate) return failure(c, 409, "display-id-exists", "Display ID already exists")

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.problem)
      .set({
        ...problemValues(parsed.data, validated.sql),
        sqlDisplay: validated.sqlDisplay,
        lastUpdateTime: new Date().toISOString(),
      })
      .where(eq(schema.problem.id, id))
      .returning()
    await setTags(tx, id, parsed.data.tags)
    return row!
  })
  return success(c, await serialize(updated))
})

// 公开题与比赛题共用一条删除路由。旧接口分成两个（admin/problem 与
// admin/contest/problem），但两边都只按题目 id 取、比赛是从题目推导出来的，
// 分开没有意义，还逼前端多传一个它未必知道的 contestId。
adminProblemRoutes.delete("/problems/:id", requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [existing] = await db
    .select()
    .from(schema.problem)
    .where(eq(schema.problem.id, id))
    .limit(1)
  if (!existing) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!(await canEdit(c.get("user")!, existing))) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }
  return deleteProblem(c, id)
})

/**
 * 删题的共用实现。
 *
 * 「有提交就不让删」这道守卫**不能去掉**：submission.problem_id 是本次唯一**没有**
 * 改成 CASCADE 的题目外键（0010），就是为了让 12 万条历史提交不会被一次误删带走。
 * 守卫先拦，报的是人话；库级外键是最后一道保险。
 * 其余子表（problem_tags / problemset_problem / problemset_submission / reaction /
 * flowchart_submission）全部交给 CASCADE，原先这里手抄了四条 delete、且漏了
 * problemset_submission —— 那条漏清被上面的守卫挡着，一直没能真的发作。
 *
 * 测试用例目录**不删** —— 与旧后端一致（它把 rmtree 注释掉了）。
 * 删错了还能从磁盘捞回来，而误删的测试数据没有别处备份；孤儿目录另有清理入口。
 */
async function deleteProblem(c: Parameters<typeof success>[0], id: number) {
  const [submissions] = await db
    .select({ value: count() })
    .from(schema.submission)
    .where(eq(schema.submission.problemId, id))
  if ((submissions?.value ?? 0) > 0) {
    return failure(c, 409, "problem-has-submissions", "该题目已有提交记录，不能删除")
  }
  await db.delete(schema.problem).where(eq(schema.problem.id, id))
  return success(c, null)
}

// ---------------------------------------------------------------- 比赛题目

adminProblemRoutes.get("/contests/:contestId/problems", requireProblemPermission, async (c) => {
  const contestId = queryInteger(c.req.param("contestId"), 0, { min: 1 })
  const [contest] = await db
    .select()
    .from(schema.contest)
    .where(eq(schema.contest.id, contestId))
    .limit(1)
  const user = c.get("user")!
  if (!contest || (user.adminType !== "Super Admin" && contest.createdById !== user.id)) {
    return failure(c, 404, "contest-not-found", "Contest does not exist")
  }
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const filters = [eq(schema.problem.contestId, contestId)]
  const keyword = c.req.query("keyword")?.trim()
  if (keyword) filters.push(ilike(schema.problem.title, `%${keyword}%`))
  const where = and(...filters)
  const [totalRow, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.problem).where(where),
    db
      .select({
        problem: schema.problem,
        user: schema.user,
        realName: schema.userProfile.realName,
      })
      .from(schema.problem)
      .innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(where)
      .orderBy(desc(schema.problem.createTime))
      .limit(limit)
      .offset(offset),
  ])
  const tags = await tagNamesFor(rows.map(({ problem }) => problem.id))
  return success(c, {
    results: rows.map(
      ({ problem, user: creator, realName }) =>
        ({
          id: problem.id,
          _id: problem.displayId,
          title: problem.title,
          createdBy: sampleUser(creator, realName),
          visible: problem.visible,
          createTime: problem.createTime,
          difficulty: problem.difficulty,
          tags: tags.get(problem.id) ?? [],
          isSql: isSqlProblem(problem),
          hasAstRules: problem.astRules !== null,
          allowFlowchart: problem.allowFlowchart,
          showFlowchart: problem.showFlowchart,
          topReaction: null,
        }) satisfies AdminProblemListItem,
    ),
    total: totalRow[0]?.value ?? 0,
  } satisfies AdminProblemList)
})

adminProblemRoutes.post("/contests/:contestId/problems", requireProblemPermission, async (c) => {
  const contestId = queryInteger(c.req.param("contestId"), 0, { min: 1 })
  const [contest] = await db
    .select()
    .from(schema.contest)
    .where(eq(schema.contest.id, contestId))
    .limit(1)
  const user = c.get("user")!
  if (!contest || (user.adminType !== "Super Admin" && contest.createdById !== user.id)) {
    return failure(c, 404, "contest-not-found", "Contest does not exist")
  }
  const parsed = await parseBody(c, createProblemRequestSchema)
  if (!parsed.success) return parsed.response
  const validated = await validateProblem(parsed.data)
  if ("error" in validated) return failure(c, 400, "invalid-problem", validated.error)

  const [duplicate] = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(
      and(eq(schema.problem.displayId, parsed.data._id), eq(schema.problem.contestId, contestId)),
    )
    .limit(1)
  if (duplicate) return failure(c, 409, "display-id-exists", "Duplicate Display id")

  const created = await insertProblem(parsed.data, validated, {
    contestId,
    createdById: user.id,
  })
  return success(c, await serialize(created), 201)
})

// ---------------------------------------------------------------- 比赛题 ⇄ 公开题

adminProblemRoutes.post("/problems/:id/make-public", requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = await parseBody(c, makeProblemPublicRequestSchema, "displayId 不能为空")
  if (!parsed.success) return parsed.response
  const [problem] = await db.select().from(schema.problem).where(eq(schema.problem.id, id)).limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  // 归属校验不能少：这个接口会把整道题（含 answers 标准答案）复制出来并回传，
  // 没有它，任何有出题权的人拿别人比赛题的 id 就能把题面和答案整份拿走。
  // 旧后端同样缺这个校验，但它只 `return self.success()` 不带数据，泄露面比这里小。
  if (!(await canEdit(c.get("user")!, problem))) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }
  if (!problem.contestId || problem.isPublic) {
    return failure(c, 409, "already-public", "Already a public problem")
  }
  const [duplicate] = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(
      and(eq(schema.problem.displayId, parsed.data.displayId), isNull(schema.problem.contestId)),
    )
    .limit(1)
  if (duplicate) return failure(c, 409, "display-id-exists", "Duplicate display ID")

  const created = await db.transaction(async (tx) => {
    // 原比赛题标记成「已转公开」，避免同一道题被转两次
    await tx.update(schema.problem).set({ isPublic: true }).where(eq(schema.problem.id, id))
    // 转出来的公开题默认不可见：题面往往还要按公开场景改一遍
    return copyProblem(tx, problem, {
      contestId: null,
      displayId: parsed.data.displayId,
      visible: false,
      isPublic: true,
    })
  })
  return success(c, await serialize(created), 201)
})

adminProblemRoutes.post(
  "/contests/:contestId/problems/from-public",
  requireProblemPermission,
  async (c) => {
    const contestId = queryInteger(c.req.param("contestId"), 0, { min: 1 })
    const parsed = await parseBody(c, addContestProblemRequestSchema)
    if (!parsed.success) return parsed.response
    const [contest] = await db
      .select()
      .from(schema.contest)
      .where(eq(schema.contest.id, contestId))
      .limit(1)
    const [problem] = await db
      .select()
      .from(schema.problem)
      .where(eq(schema.problem.id, parsed.data.problemId))
      .limit(1)
    const user = c.get("user")!
    // 「比赛不存在」和「比赛存在但不是你的」必须回同一个码。分开报的话，带一个已知有效的
    // problemId 就能靠错误码差异枚举出哪些 contestId 真实存在。全仓其余跨租户路径都是
    // 统一码（contest 系列一律 contest-not-found），这里对齐。
    const denyContest =
      !contest || (user.adminType !== "Super Admin" && contest.createdById !== user.id)
    if (denyContest) return failure(c, 404, "contest-not-found", "Contest does not exist")
    if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
    // 源题必须是**公开题**，且要么已可见、要么是自己的。旧后端只按 id 取，不校验任何东西 ——
    // 于是能把别人比赛里的题（或别人尚未公开的草稿）拖进自己比赛，进而读到 answers。
    if (problem.contestId !== null) {
      return failure(c, 400, "not-a-public-problem", "只能从公开题库添加题目")
    }
    if (!problem.visible && !(await canEdit(user, problem))) {
      return failure(c, 404, "problem-not-found", "Problem does not exist")
    }
    if (contestStatus(contest) === "-1")
      return failure(c, 409, "contest-ended", "Contest has ended")

    const [duplicate] = await db
      .select({ id: schema.problem.id })
      .from(schema.problem)
      .where(
        and(
          eq(schema.problem.contestId, contestId),
          eq(schema.problem.displayId, parsed.data.displayId),
        ),
      )
      .limit(1)
    if (duplicate)
      return failure(c, 409, "display-id-exists", "Duplicate display id in this contest")

    const created = await db.transaction((tx) =>
      copyProblem(tx, problem, {
        contestId,
        displayId: parsed.data.displayId,
        visible: true,
        isPublic: true,
      }),
    )
    return success(c, await serialize(created), 201)
  },
)

/**
 * 比赛题按给定顺序重新编号 1、2、3…（新建比赛页拖动排序用）。
 * 榜单、提交、草稿都按题目 id 记，改编号不影响已经交的东西；比赛结束后就不让动了，
 * 免得赛后对着「第 3 题」讲评时题号变了。
 * 唯一约束是 (_id, contest_id)，直接改会和还没改的那道撞，所以先统一挪到临时编号再写回来
 */
adminProblemRoutes.put(
  "/contests/:contestId/problems/order",
  requireProblemPermission,
  async (c) => {
    const contestId = queryInteger(c.req.param("contestId"), 0, { min: 1 })
    const parsed = await parseBody(c, reorderContestProblemsRequestSchema)
    if (!parsed.success) return parsed.response
    const [contest] = await db
      .select()
      .from(schema.contest)
      .where(eq(schema.contest.id, contestId))
      .limit(1)
    const user = c.get("user")!
    if (!contest || (user.adminType !== "Super Admin" && contest.createdById !== user.id)) {
      return failure(c, 404, "contest-not-found", "Contest does not exist")
    }
    if (contestStatus(contest) === "-1")
      return failure(c, 409, "contest-ended", "比赛已经结束，不能再改题号")
    const existing = await db
      .select({ id: schema.problem.id })
      .from(schema.problem)
      .where(eq(schema.problem.contestId, contestId))
    const ids = parsed.data.problemIds
    const all = new Set(existing.map((row) => row.id))
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== all.size ||
      ids.some((id) => !all.has(id))
    ) {
      return failure(c, 400, "problem-list-mismatch", "题目列表和比赛里的对不上，请刷新后再排")
    }
    await db.transaction(async (tx) => {
      for (const id of ids) {
        await tx
          .update(schema.problem)
          .set({ displayId: `__${id}` })
          .where(eq(schema.problem.id, id))
      }
      for (const [index, id] of ids.entries()) {
        await tx
          .update(schema.problem)
          .set({ displayId: String(index + 1) })
          .where(eq(schema.problem.id, id))
      }
    })
    return success(c, null)
  },
)

// ---------------------------------------------------------------- 测试用例

adminProblemRoutes.post("/test-cases", requireProblemPermission, async (c) => {
  const form = await c.req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return failure(c, 400, "invalid-request", "Upload failed")
  const sql = ["1", "true", "True"].includes(String(form?.get("sql") ?? ""))
  try {
    const result = await processTestCaseZip(new Uint8Array(await file.arrayBuffer()), { sql })
    return success(
      c,
      {
        id: result.testCaseId,
        info: result.info,
      } satisfies UploadTestCaseResponse,
      201,
    )
  } catch (error) {
    if (error instanceof TestCaseError) return failure(c, 400, "invalid-test-case", error.message)
    console.error("Failed to process test case zip", error)
    return failure(c, 500, "test-case-error", "测试点处理失败")
  }
})

adminProblemRoutes.get("/problems/:id/test-cases", requireProblemPermission, async (c) => {
  const [problem] = await db
    .select()
    .from(schema.problem)
    .where(eq(schema.problem.id, queryInteger(c.req.param("id"), 0, { min: 1 })))
    .limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!(await canEdit(c.get("user")!, problem))) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }
  try {
    const archive = await packTestCaseZip(problem.testCaseId)
    return new Response(archive, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename=problem_${problem.id}_test_cases.zip`,
      },
    })
  } catch (error) {
    if (error instanceof TestCaseError) return failure(c, 404, "test-case-not-found", error.message)
    throw error
  }
})

/**
 * 回显 SQL 题已上传的测试点脚本内容。只读磁盘上的 N.sql，不需要 SQL 引擎 ——
 * 同组的 sql-preview / sql-ai-gen 要跑 SQLite 生成展示数据，新后端还没有那条链路，
 * 那两个仍在旧后端上。
 */
adminProblemRoutes.get("/problems/:id/sql-scripts", requireProblemPermission, async (c) => {
  const [problem] = await db
    .select()
    .from(schema.problem)
    .where(eq(schema.problem.id, queryInteger(c.req.param("id"), 0, { min: 1 })))
    .limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!(await canEdit(c.get("user")!, problem))) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }
  const info = await readInfo(problem.testCaseId)
  if (!info) return failure(c, 404, "test-case-info-unreadable", "测试点信息读取失败")
  if (!info.sql) return failure(c, 409, "not-sql-test-case", "该题的测试点不是 SQL 类型")
  try {
    const scripts = await readSqlScripts(problem.testCaseId)
    return success(c, scripts satisfies SqlTestCaseScript[])
  } catch (error) {
    console.error("Failed to read SQL test case scripts", error)
    return failure(c, 500, "test-case-error", "测试点脚本读取失败")
  }
})

/**
 * 回显编程题已有的测试点原文，出题页就地改。太大的（见契约 TEST_CASE_EDIT_*）只给数量和大小。
 * SQL 题的测试点是脚本，走上面的 sql-scripts。
 */
adminProblemRoutes.get("/problems/:id/test-case-files", requireProblemPermission, async (c) => {
  const [problem] = await db
    .select()
    .from(schema.problem)
    .where(eq(schema.problem.id, queryInteger(c.req.param("id"), 0, { min: 1 })))
    .limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!(await canEdit(c.get("user")!, problem))) {
    return failure(c, 404, "problem-not-found", "Problem does not exist")
  }
  const info = await readInfo(problem.testCaseId)
  if (info?.sql) return failure(c, 409, "sql-test-case", "该题的测试点是 SQL 脚本")
  try {
    const files = await readTestCaseFiles(problem.testCaseId, {
      maxCases: TEST_CASE_EDIT_MAX_CASES,
      maxFileBytes: TEST_CASE_EDIT_MAX_FILE_BYTES,
    })
    return success(c, files satisfies TestCaseFiles)
  } catch (error) {
    if (error instanceof TestCaseError)
      return failure(c, 404, "test-case-not-found", "测试点文件不存在")
    throw error
  }
})

/** 语法要求：每条规则学生看到的那句话 + 标准答案过不过，和判题时同一个 checkAst */
adminProblemRoutes.post("/ast-check", requireProblemPermission, async (c) => {
  const parsed = await parseBody(c, astCheckRequestSchema)
  if (!parsed.success) return parsed.response
  const { language, code, rules } = parsed.data
  const error = astRulesError({ [language]: rules })
  if (error) return failure(c, 400, "invalid-ast-rules", error)
  const checked = []
  for (const rule of rules) {
    const description = describeAstRule(rule, language)
    if (!code.trim()) {
      checked.push({ description, passed: null })
      continue
    }
    const [result] = (await checkAst(code, language, [rule])).results
    checked.push({ description, passed: result?.passed ?? null, actual: result?.actual })
  }
  return success(c, { rules: checked } satisfies AstCheckResponse)
})

/**
 * AI 按题面和标准答案想几组测试输入。只要输入：输出一律由标准答案在判题机上跑，
 * AI 编的输出不可信。
 */
adminProblemRoutes.post("/test-inputs/generate", requireProblemPermission, async (c) => {
  const parsed = await parseBody(c, generateTestInputsRequestSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data
  const existing = body.existing.length
    ? body.existing.map((input, i) => `第 ${i + 1} 组：\n${input}`).join("\n\n")
    : "（还没有）"
  try {
    const raw = await completeChat(
      `你是编程题出题助手，帮老师补测试数据。老师会给你题目描述、输入说明、标准答案和已有的测试输入。
请再想 5 组新的测试输入，要和已有的不重复，重点覆盖边界情况（最小值、最大值、0、负数、
重复元素、只有一个元素、各个分支都要走到……），但必须严格符合输入说明的格式，标准答案要能正常处理。
数据规模保持小，每组不超过 20 行。
只回 json：{"inputs": ["第一组输入", "第二组输入", ...]}，每组输入是一个字符串，多行用 \\n 分隔。`,
      [
        `题目描述：${plainText(body.description).slice(0, 3000)}`,
        `输入说明：${plainText(body.inputDescription).slice(0, 1000) || "无"}`,
        `标准答案（${body.language}）：\n${body.answer}`,
        `已有的测试输入：\n${existing.slice(0, 4000)}`,
      ].join("\n\n"),
      { json: true },
    )
    const value: unknown = JSON.parse(raw)
    const list =
      value && typeof value === "object" && Array.isArray((value as { inputs?: unknown }).inputs)
        ? ((value as { inputs: unknown[] }).inputs.filter((x) => typeof x === "string") as string[])
        : []
    const known = new Set(body.existing.map((input) => input.trim()))
    const inputs = list.filter((input) => !known.has(input.trim())).slice(0, 10)
    return success(c, { inputs } satisfies GenerateTestInputsResponse)
  } catch (error) {
    console.error("Test input generation failed", error)
    return failure(c, 502, "ai-unavailable", "生成失败，请稍后再试")
  }
})

/** SQL 题测试点预览：跑一遍初始化脚本 + 标准答案，返回题目页要展示的数据表与期望结果 */
adminProblemRoutes.post("/sql-test-cases/preview", requireProblemPermission, async (c) => {
  const parsed = await parseBody(c, sqlPreviewRequestSchema)
  if (!parsed.success) return parsed.response
  const outcome = await buildSqlDisplay(
    parsed.data.initSql,
    parsed.data.refSql,
    parsed.data.mode,
    parsed.data.shown,
  )
  if (!outcome.ok) return failure(c, 400, "sql-preview-failed", outcome.message)
  return success(c, outcome.value)
})

/** AI 按标准答案倒推表结构、生成一份自洽的初始化脚本 */
adminProblemRoutes.post("/sql-test-cases/generate", requireProblemPermission, async (c) => {
  const parsed = await parseBody(c, generateSqlTestCaseRequestSchema)
  if (!parsed.success) return parsed.response
  try {
    const sql = await completeChat(
      `你是一个 SQL 出题助手。用户会给你一道 SQL 题的标准答案（查询题的
SELECT 语句，或增删改题的 UPDATE/DELETE/INSERT 语句）和题型。
请你推断出该标准答案所需要的表结构，生成一份自洽的 SQLite 兼容初始化脚本，
包含 CREATE TABLE 和若干条 INSERT 语句，插入的数据要足够让标准答案跑出有意义的结果
（比如查询题要有能被筛选出来和被过滤掉的行；增删改题要有能被改动和不受影响的行）。
请只返回 SQL 脚本本身，连 \`\`\` 都不需要，不要任何解释文字。`,
      `题型：${parsed.data.mode}\n标准答案：\n${parsed.data.refSql}`,
    )
    return success(c, { sql } satisfies GenerateSqlTestCaseResponse)
  } catch (error) {
    console.error("SQL test case generation failed", error)
    return failure(c, 502, "ai-unavailable", "生成失败，请稍后再试")
  }
})
