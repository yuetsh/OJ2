import {
  acmHelperItemSchema,
  adminContestListSchema,
  adminContestSchema,
  createContestRequestSchema,
  updateAcmHelperRequestSchema,
  updateContestRequestSchema,
} from "@oj2/contract"
import { and, count, desc, eq, ilike, inArray } from "drizzle-orm"
import { Hono } from "hono"

import { requireTeacher, type AppEnv } from "../../auth/middleware"
import type { AuthUser } from "../../auth/session"
import { db, schema } from "../../db"
import { failure, success } from "../../http"
import { contestStatus } from "../../services/contest"
import { objectValue, queryInteger, sampleUser } from "../helpers"

export const adminContestRoutes = new Hono<AppEnv>()

/**
 * 「只能管自己建的」。对齐旧 `ensure_created_by`：超管放行，其余人只能碰自己创建的。
 * 越权时报的是**不存在**而不是无权限 —— 不泄露「有这么个东西但你看不到」。
 */
function ownedBy(user: AuthUser, contest: { createdById: number }) {
  return user.adminType === "Super Admin" || contest.createdById === user.id
}

/** CIDR 校验。`ip_network(strict=False)` 的等价物：允许主机位非零，如 192.168.1.5/24 */
function validCidr(value: string) {
  const [address, prefixText] = value.split("/")
  const octets = (address ?? "").split(".")
  if (octets.length !== 4) return false
  if (!octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false
  if (prefixText === undefined) return true
  return /^\d{1,2}$/.test(prefixText) && Number(prefixText) <= 32
}

async function serialize(row: {
  contest: typeof schema.contest.$inferSelect
  user: typeof schema.user.$inferSelect
  realName: string | null
}) {
  return adminContestSchema.parse({
    id: row.contest.id,
    title: row.contest.title,
    description: row.contest.description,
    tag: row.contest.tag,
    startTime: row.contest.startTime,
    endTime: row.contest.endTime,
    createTime: row.contest.createTime,
    lastUpdateTime: row.contest.lastUpdateTime,
    password: row.contest.password,
    visible: row.contest.visible,
    allowedIpRanges: Array.isArray(row.contest.allowedIpRanges)
      ? row.contest.allowedIpRanges.filter((item): item is string => typeof item === "string")
      : [],
    createdBy: sampleUser(row.user, row.realName),
    status: contestStatus(row.contest),
    contestType: row.contest.password ? "Password Protected" : "Public",
  })
}

function selectContest(id: number) {
  return db.select({ contest: schema.contest, user: schema.user, realName: schema.userProfile.realName })
    .from(schema.contest)
    .innerJoin(schema.user, eq(schema.contest.createdById, schema.user.id))
    .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
    .where(eq(schema.contest.id, id)).limit(1)
}

/** 请求体里的时间与 CIDR 校验，创建和编辑共用 */
function validatePayload(data: { startTime: string; endTime: string; allowedIpRanges: string[] }) {
  const start = Date.parse(data.startTime)
  const end = Date.parse(data.endTime)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "开始或结束时间不是合法的时间格式"
  if (end <= start) return "Start time must occur earlier than end time"
  for (const range of data.allowedIpRanges) {
    if (!validCidr(range)) return `${range} is not a valid cidr network`
  }
  return null
}

adminContestRoutes.get("/contests", requireTeacher, async (c) => {
  const limit = queryInteger(c.req.query("limit"), 10, { min: 1, max: 250 })
  const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
  const user = c.get("user")!
  const filters = []
  // 非超管只看得到自己建的比赛，与旧后端一致
  if (user.adminType !== "Super Admin") filters.push(eq(schema.contest.createdById, user.id))
  const keyword = c.req.query("keyword")?.trim()
  if (keyword) filters.push(ilike(schema.contest.title, `%${keyword}%`))
  const where = filters.length ? and(...filters) : undefined

  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.contest).where(where),
    db.select({ contest: schema.contest, user: schema.user, realName: schema.userProfile.realName })
      .from(schema.contest)
      .innerJoin(schema.user, eq(schema.contest.createdById, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(where).orderBy(desc(schema.contest.createTime)).limit(limit).offset(offset),
  ])
  return success(c, adminContestListSchema.parse({
    results: await Promise.all(rows.map(serialize)),
    total: totalRows[0]?.value ?? 0,
  }))
})

adminContestRoutes.get("/contests/:id", requireTeacher, async (c) => {
  const [row] = await selectContest(queryInteger(c.req.param("id"), 0, { min: 1 }))
  if (!row || !ownedBy(c.get("user")!, row.contest)) {
    return failure(c, 404, "contest-not-found", "Contest does not exist")
  }
  return success(c, await serialize(row))
})

adminContestRoutes.post("/contests", requireTeacher, async (c) => {
  const parsed = createContestRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const error = validatePayload(parsed.data)
  if (error) return failure(c, 400, "invalid-contest", error)

  const now = new Date().toISOString()
  const [created] = await db.insert(schema.contest).values({
    title: parsed.data.title,
    description: parsed.data.description,
    tag: parsed.data.tag,
    startTime: new Date(parsed.data.startTime).toISOString(),
    endTime: new Date(parsed.data.endTime).toISOString(),
    // 空串归一成 null，否则 contestType 会把「密码是空字符串」当成密码保护赛
    password: parsed.data.password || null,
    visible: parsed.data.visible,
    allowedIpRanges: parsed.data.allowedIpRanges,
    createdById: c.get("user")!.id,
    createTime: now,
    lastUpdateTime: now,
  }).returning({ id: schema.contest.id })
  const [row] = await selectContest(created!.id)
  return success(c, await serialize(row!), 201)
})

adminContestRoutes.put("/contests/:id", requireTeacher, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = updateContestRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const [existing] = await selectContest(id)
  if (!existing || !ownedBy(c.get("user")!, existing.contest)) {
    return failure(c, 404, "contest-not-found", "Contest does not exist")
  }
  const error = validatePayload(parsed.data)
  if (error) return failure(c, 400, "invalid-contest", error)

  await db.update(schema.contest).set({
    title: parsed.data.title,
    description: parsed.data.description,
    tag: parsed.data.tag,
    startTime: new Date(parsed.data.startTime).toISOString(),
    endTime: new Date(parsed.data.endTime).toISOString(),
    password: parsed.data.password || null,
    visible: parsed.data.visible,
    allowedIpRanges: parsed.data.allowedIpRanges,
    lastUpdateTime: new Date().toISOString(),
  }).where(eq(schema.contest.id, id))
  const [row] = await selectContest(id)
  return success(c, await serialize(row!))
})

adminContestRoutes.post("/contests/:id/clone", requireTeacher, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [original] = await selectContest(id)
  // 克隆不要求 ownedBy：旧后端这里也没有 ensure_created_by，教师可以拿别人的比赛做模板。
  // 克隆出来的归调用者所有、且默认不可见，所以不构成越权修改。
  if (!original) return failure(c, 404, "contest-not-found", "Contest does not exist")

  const duration = Date.parse(original.contest.endTime) - Date.parse(original.contest.startTime)
  // 新比赛从 10 分钟后开始，时长与原比赛相同 —— 给出题人留出改时间的余地，
  // 又不至于建出一个已经结束的比赛
  const start = new Date(Date.now() + 10 * 60 * 1000)
  const end = new Date(start.getTime() + duration)
  const now = new Date().toISOString()
  const me = c.get("user")!.id

  const cloned = await db.transaction(async (tx) => {
    const [contest] = await tx.insert(schema.contest).values({
      title: original.contest.title,
      description: original.contest.description,
      tag: original.contest.tag,
      // 不复制原比赛的密码。两个理由：一是克隆出来是一场新比赛、时间也是新的，
      // 沿用旧密码意味着拿着旧密码的学生直接能进；二是本接口不校验归属
      // （旧后端也不校验，教师可以拿别人的比赛做模板），复制过来就等于把别人的
      // 比赛密码原样回传给调用者。克隆者自己重新设一个。
      password: null,
      // 克隆出来的一律不可见：时间是拍脑袋定的 10 分钟后，直接开放会让学生看到一场没准备好的赛
      visible: false,
      allowedIpRanges: original.contest.allowedIpRanges,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      createdById: me,
      createTime: now,
      lastUpdateTime: now,
    }).returning({ id: schema.contest.id })

    const problems = await tx.select().from(schema.problem)
      .where(eq(schema.problem.contestId, id))
    if (problems.length === 0) return contest!.id

    // 题面、标签各一条语句，不再按题循环。新旧题的对应关系靠 _id 认：
    // 克隆出来的题原样保留 _id，而它们全在同一场新比赛里，彼此不会重名。
    const copies = await tx.insert(schema.problem).values(problems.map(({ id: _oldId, ...rest }) => ({
      ...rest,
      contestId: contest!.id,
      // 计数器归零：克隆的是题面，不是历史战绩
      submissionNumber: 0,
      acceptedNumber: 0,
      statisticInfo: {},
      createdById: me,
      createTime: now,
      lastUpdateTime: now,
    }))).returning({ id: schema.problem.id, displayId: schema.problem.displayId })
    const newIdByDisplayId = new Map(copies.map((copy) => [copy.displayId, copy.id]))

    // 标签是多对多中间表，Django 的 problem.tags.set(tags) 对应这里手工复制关系行
    const tags = await tx.select({ problemId: schema.problemTags.problemId, tagId: schema.problemTags.problemtagId })
      .from(schema.problemTags).where(inArray(schema.problemTags.problemId, problems.map((problem) => problem.id)))
    if (tags.length) {
      const displayIdByOldId = new Map(problems.map((problem) => [problem.id, problem.displayId]))
      const links = tags.flatMap((tag) => {
        const newId = newIdByDisplayId.get(displayIdByOldId.get(tag.problemId) ?? "")
        return newId === undefined ? [] : [{ problemId: newId, problemtagId: tag.tagId }]
      })
      if (links.length) await tx.insert(schema.problemTags).values(links)
    }
    return contest!.id
  })

  const [row] = await selectContest(cloned)
  return success(c, await serialize(row!), 201)
})

// ---------------------------------------------------------------- ACM 赛后核查

adminContestRoutes.get("/contests/:id/acm-helper", requireTeacher, async (c) => {
  const id = queryInteger(c.req.param("id"), 0, { min: 1 })
  const [contest] = await db.select().from(schema.contest)
    .where(and(eq(schema.contest.id, id), eq(schema.contest.visible, true))).limit(1)
  if (!contest || !ownedBy(c.get("user")!, contest)) {
    return failure(c, 404, "contest-not-found", "Contest does not exist")
  }

  const [problems, ranks] = await Promise.all([
    db.select({ id: schema.problem.id, displayId: schema.problem.displayId })
      .from(schema.problem).where(eq(schema.problem.contestId, id)),
    db.select({
      id: schema.acmContestRank.id,
      username: schema.user.username,
      realName: schema.userProfile.realName,
      submissionInfo: schema.acmContestRank.submissionInfo,
      acceptedNumber: schema.acmContestRank.acceptedNumber,
    }).from(schema.acmContestRank)
      .innerJoin(schema.user, eq(schema.acmContestRank.userId, schema.user.id))
      .leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
      .where(eq(schema.acmContestRank.contestId, id)),
  ])
  const displayIds = new Map(problems.map((problem) => [String(problem.id), problem.displayId]))

  const results = []
  for (const rank of ranks) {
    if (rank.acceptedNumber <= 0) continue
    for (const [problemId, raw] of Object.entries(objectValue(rank.submissionInfo))) {
      const info = objectValue(raw)
      if (info.is_ac !== true) continue
      results.push({
        id: rank.id,
        username: rank.username,
        // 真名在这里是**有意下发**的：核查页就是老师对着名单一个个确认谁抄了。
        // 接口已由 requireTeacher + ownedBy 双重把关。
        realName: rank.realName,
        problemId,
        problemDisplayId: displayIds.get(problemId) ?? problemId,
        acInfo: info,
        checked: info.checked === true,
        _acTime: typeof info.ac_time === "number" ? info.ac_time : 0,
      })
    }
  }
  // 按 AC 用时倒序：最后才做出来的排前面，那是最值得看的
  results.sort((left, right) => right._acTime - left._acTime)
  return success(c, results.map(({ _acTime, ...item }) => acmHelperItemSchema.parse(item)))
})

adminContestRoutes.put("/contests/:id/acm-helper", requireTeacher, async (c) => {
  const contestId = queryInteger(c.req.param("id"), 0, { min: 1 })
  const parsed = updateAcmHelperRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  const [contest] = await db.select().from(schema.contest).where(eq(schema.contest.id, contestId)).limit(1)
  if (!contest || !ownedBy(c.get("user")!, contest)) {
    return failure(c, 404, "contest-not-found", "Contest does not exist")
  }
  // rank 必须属于这场比赛。旧后端只按 rank_id 取，不校验归属 ——
  // 那样带上任意 rank_id 就能改别的比赛的核查标记
  const [rank] = await db.select().from(schema.acmContestRank).where(and(
    eq(schema.acmContestRank.id, parsed.data.rankId),
    eq(schema.acmContestRank.contestId, contestId),
  )).limit(1)
  if (!rank) return failure(c, 404, "rank-not-found", "Rank id does not exist")

  const info = objectValue(rank.submissionInfo)
  const entry = objectValue(info[parsed.data.problemId])
  if (!info[parsed.data.problemId]) {
    return failure(c, 404, "problem-not-in-rank", "Problem id does not exist")
  }
  entry.checked = parsed.data.checked
  info[parsed.data.problemId] = entry
  await db.update(schema.acmContestRank).set({ submissionInfo: info })
    .where(eq(schema.acmContestRank.id, rank.id))
  return success(c, null)
})
