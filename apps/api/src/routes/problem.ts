import {
	problemAuthorSchema,
	problemDetailSchema,
	problemListItemSchema,
	problemListSchema,
	problemSummarySchema,
	tagSchema,
	yearlyAcSchema,
} from "@oj2/contract"
import {
	and,
	asc,
	count,
	countDistinct,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	isNull,
	notInArray,
	or,
	sql,
} from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"
import { JudgeStatus } from "../judge/status"
import { objectValue as toObject, queryInteger } from "./helpers"

export const problemRoutes = new Hono<AppEnv>()

function objectValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function publicTemplates(value: unknown) {
	const templates: Record<string, string> = {}
	for (const [language, raw] of Object.entries(objectValue(value))) {
		if (typeof raw !== "string") continue
		const match = raw.match(/\/\/TEMPLATE BEGIN\n([\s\S]+?)\/\/TEMPLATE END/)
		templates[language] = match?.[1] ?? ""
	}
	return templates
}

async function getProblemStatuses(userId: number | undefined) {
	if (!userId) return {}
	const [profile] = await db.select({ value: schema.userProfile.acmProblemsStatus })
		.from(schema.userProfile).where(eq(schema.userProfile.userId, userId)).limit(1)
	return toObject(toObject(profile?.value).problems)
}

async function getProblemTags(problemIds: number[]) {
	if (problemIds.length === 0) return new Map<number, string[]>()
	const rows = await db.select({ problemId: schema.problemTags.problemId, name: schema.problemTag.name })
		.from(schema.problemTags)
		.innerJoin(schema.problemTag, eq(schema.problemTags.problemtagId, schema.problemTag.id))
		.where(inArray(schema.problemTags.problemId, problemIds))
	const result = new Map<number, string[]>()
	for (const row of rows) result.set(row.problemId, [...(result.get(row.problemId) ?? []), row.name])
	return result
}

function listItem(
	row: { problem: typeof schema.problem.$inferSelect; user: typeof schema.user.$inferSelect; realName: string | null },
	tags: Map<number, string[]>,
	statuses: Record<string, unknown>,
) {
	const status = toObject(statuses[String(row.problem.id)]).status
	return problemListItemSchema.parse({
		id: row.problem.id,
		_id: row.problem.displayId,
		title: row.problem.title,
		submissionNumber: row.problem.submissionNumber,
		acceptedNumber: row.problem.acceptedNumber,
		difficulty: row.problem.difficulty,
		createdBy: { id: row.user.id, username: row.user.username, realName: row.realName },
		tags: tags.get(row.problem.id) ?? [],
		contestId: row.problem.contestId,
		allowFlowchart: row.problem.allowFlowchart,
		showFlowchart: row.problem.showFlowchart,
		hasAstRules: row.problem.astRules !== null,
		myStatus: typeof status === "number" ? status : null,
	})
}

problemRoutes.get("/problems", optionalAuth, async (c) => {
	const limit = queryInteger(c.req.query("limit"), 20, { min: 1, max: 250 })
	const offset = queryInteger(c.req.query("offset"), 0, { min: 0 })
	const filters = [eq(schema.problem.visible, true), isNull(schema.problem.contestId)]
	const author = c.req.query("author")?.trim()
	const keyword = c.req.query("keyword")?.trim()
	const difficulty = c.req.query("difficulty")?.trim()
	const tag = c.req.query("tag")?.trim()
	if (author) filters.push(eq(schema.user.username, author))
	if (keyword) filters.push(or(ilike(schema.problem.title, `%${keyword}%`), ilike(schema.problem.displayId, `%${keyword}%`))!)
	if (difficulty) filters.push(eq(schema.problem.difficulty, difficulty))
	if (tag) {
		filters.push(inArray(schema.problem.id, db.select({ id: schema.problemTags.problemId }).from(schema.problemTags)
			.innerJoin(schema.problemTag, eq(schema.problemTags.problemtagId, schema.problemTag.id))
			.where(eq(schema.problemTag.name, tag))))
	}

	const where = and(...filters)
	const sort = c.req.query("sort")
	const order = sort === "flowchart"
		? [desc(schema.problem.allowFlowchart), desc(schema.problem.showFlowchart), desc(schema.problem.createTime)]
		: sort === "ast"
			? [desc(sql`(${schema.problem.astRules} is not null)`), desc(schema.problem.createTime)]
			: sort === "-accepted_number"
				? [desc(schema.problem.acceptedNumber)]
				: sort === "accepted_number"
					? [asc(schema.problem.acceptedNumber)]
					: sort === "-submission_number"
						? [desc(schema.problem.submissionNumber)]
						: sort === "submission_number"
							? [asc(schema.problem.submissionNumber)]
					: sort === "difficulty"
						? [asc(schema.problem.difficulty)]
						: sort === "create_time"
							? [asc(schema.problem.createTime)]
						: [desc(schema.problem.createTime)]
	const [totalRow] = await db.select({ value: countDistinct(schema.problem.id) }).from(schema.problem)
		.innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id)).where(where)
	const rows = await db.select({ problem: schema.problem, user: schema.user, realName: schema.userProfile.realName })
		.from(schema.problem)
		.innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
		.leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
		.where(where).orderBy(...order).limit(limit).offset(offset)
	const [tags, statuses] = await Promise.all([
		getProblemTags(rows.map((row) => row.problem.id)),
		getProblemStatuses(c.get("user")?.id),
	])
	return success(c, problemListSchema.parse({
		results: rows.map((row) => listItem(row, tags, statuses)),
		total: totalRow?.value ?? 0,
	}))
})

problemRoutes.get("/problem-tags", async (c) => {
	const keyword = c.req.query("keyword")?.trim()
	const rows = await db.select({ id: schema.problemTag.id, name: schema.problemTag.name, problemCount: countDistinct(schema.problemTags.problemId) })
		.from(schema.problemTag)
		.innerJoin(schema.problemTags, eq(schema.problemTags.problemtagId, schema.problemTag.id))
		.where(keyword ? ilike(schema.problemTag.name, `%${keyword}%`) : undefined)
		.groupBy(schema.problemTag.id, schema.problemTag.name).having(sql`count(${schema.problemTags.problemId}) > 0`)
		.orderBy(asc(schema.problemTag.name))
	return success(c, rows.map((row) => tagSchema.parse(row)))
})

problemRoutes.get("/problems/random", async (c) => {
	const [row] = await db.select({ displayId: schema.problem.displayId }).from(schema.problem)
		.where(and(eq(schema.problem.visible, true), isNull(schema.problem.contestId))).orderBy(sql`random()`).limit(1)
	if (!row) return failure(c, 404, "no-problems", "No problem to pick")
	return success(c, row.displayId)
})

problemRoutes.get("/problem-authors", async (c) => {
	const showAll = c.req.query("all") === "1"
	const rows = await db.select({ username: schema.user.username, problemCount: count(schema.problem.id) })
		.from(schema.problem).innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
		.where(and(isNull(schema.problem.contestId), eq(schema.user.isDisabled, false), showAll ? undefined : eq(schema.problem.visible, true)))
		.groupBy(schema.user.username).orderBy(desc(count(schema.problem.id)))
	return success(c, rows.map((row) => problemAuthorSchema.parse(row)))
})

problemRoutes.get("/problems/:id/beat-count", optionalAuth, async (c) => {
	const user = c.get("user")
	if (!user) return success(c, "0")
	const id = queryInteger(c.req.param("id"), 0, { min: 1 })
	const [mine] = await db.select({ value: count() }).from(schema.submission).where(and(
		eq(schema.submission.userId, user.id), eq(schema.submission.problemId, id),
		inArray(schema.submission.result, [JudgeStatus.ACCEPTED, JudgeStatus.AST_CHECK_FAILED]),
	))
	if (!mine?.value) return success(c, "0")
	const since = new Date(); since.setFullYear(since.getFullYear() - 2); since.setHours(0, 0, 0, 0)
	const [active, accepted] = await Promise.all([
		db.select({ value: count() }).from(schema.user).where(and(eq(schema.user.isDisabled, false), gte(schema.user.lastLogin, since.toISOString()))),
		db.select({ value: countDistinct(schema.submission.userId) }).from(schema.submission).where(and(
			eq(schema.submission.problemId, id), inArray(schema.submission.result, [0, 10]), gte(schema.submission.createTime, since.toISOString()),
		)),
	])
	const total = active[0]?.value ?? 0
	const solved = accepted[0]?.value ?? 0
	return success(c, total > 0 && solved < total ? (((total - solved) / total) * 100).toFixed(2) : "0")
})

problemRoutes.get("/problems/:displayId/similar", optionalAuth, async (c) => {
	const [target] = await db.select({ id: schema.problem.id }).from(schema.problem)
		.where(and(sql`lower(${schema.problem.displayId}) = lower(${c.req.param("displayId")})`, isNull(schema.problem.contestId))).limit(1)
	if (!target) return failure(c, 404, "problem-not-found", "Problem not found")
	const targetTags = await db.select({ id: schema.problemTags.problemtagId }).from(schema.problemTags).where(eq(schema.problemTags.problemId, target.id))
	if (targetTags.length === 0) return success(c, [])
	const rows = await db.select({ problem: schema.problem, user: schema.user, realName: schema.userProfile.realName })
		.from(schema.problem)
		.innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
		.leftJoin(schema.userProfile, eq(schema.userProfile.userId, schema.user.id))
		.where(and(
			eq(schema.problem.visible, true), isNull(schema.problem.contestId), sql`${schema.problem.id} <> ${target.id}`,
			inArray(schema.problem.id, db.select({ id: schema.problemTags.problemId }).from(schema.problemTags)
				.where(inArray(schema.problemTags.problemtagId, targetTags.map((tag) => tag.id)))),
		)).groupBy(schema.problem.id, schema.user.id, schema.userProfile.realName).orderBy(asc(schema.problem.difficulty)).limit(5)
	const [tags, statuses] = await Promise.all([getProblemTags(rows.map((row) => row.problem.id)), getProblemStatuses(c.get("user")?.id)])
	const filtered = rows.filter((row) => toObject(statuses[String(row.problem.id)]).status !== JudgeStatus.ACCEPTED)
	return success(c, filtered.map((row) => listItem(row, tags, statuses)))
})

problemRoutes.get("/problems/:displayId/yearly-ac", async (c) => {
	const [problem] = await db.select({ id: schema.problem.id }).from(schema.problem)
		.where(and(sql`lower(${schema.problem.displayId}) = lower(${c.req.param("displayId")})`, isNull(schema.problem.contestId), eq(schema.problem.visible, true))).limit(1)
	if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
	const year = sql<number>`extract(year from ${schema.submission.createTime})::int`
	const rows = await db.select({
		year,
		total: count(),
		accepted: sql<number>`count(*) filter (where ${schema.submission.result} in (0, 10))::int`,
	}).from(schema.submission).where(and(eq(schema.submission.problemId, problem.id), isNull(schema.submission.contestId), notInArray(schema.submission.result, [6, 7])))
		.groupBy(year).orderBy(year)
	return success(c, rows.map((row) => yearlyAcSchema.parse({ ...row, acRate: row.total > 0 ? Math.round(row.accepted / row.total * 10_000) / 100 : 0 })))
})

problemRoutes.get("/dev/problems", async (c) => {
	const rows = await db
		.select({
			id: schema.problem.id,
			_id: schema.problem.displayId,
			title: schema.problem.title,
			difficulty: schema.problem.difficulty,
			submissionNumber: schema.problem.submissionNumber,
			acceptedNumber: schema.problem.acceptedNumber,
		})
		.from(schema.problem)
		.where(and(eq(schema.problem.visible, true), isNull(schema.problem.contestId)))
		.orderBy(desc(schema.problem.id))
		.limit(20)

	const data = rows.map((row) => problemSummarySchema.parse(row))
	return success(c, data)
})

problemRoutes.get("/problems/:displayId", optionalAuth, async (c) => {
	const [row] = await db
		.select({
			problem: schema.problem,
			creatorId: schema.user.id,
			creatorUsername: schema.user.username,
		})
		.from(schema.problem)
		.innerJoin(schema.user, eq(schema.problem.createdById, schema.user.id))
		.where(
			and(
				eq(schema.problem.displayId, c.req.param("displayId")),
				eq(schema.problem.visible, true),
				isNull(schema.problem.contestId),
			),
		)
		.limit(1)

	if (!row) return failure(c, 404, "problem-not-found", "Problem does not exist")

	const tagRows = await db
		.select({ name: schema.problemTag.name })
		.from(schema.problemTags)
		.innerJoin(
			schema.problemTag,
			eq(schema.problemTags.problemtagId, schema.problemTag.id),
		)
		.where(eq(schema.problemTags.problemId, row.problem.id))

	const user = c.get("user")
	let myStatus: number | null = null
	let myFailedCount = 0
	if (user) {
		const [profile] = await db
			.select({ status: schema.userProfile.acmProblemsStatus })
			.from(schema.userProfile)
			.where(eq(schema.userProfile.userId, user.id))
			.limit(1)
		const statuses = objectValue(objectValue(profile?.status).problems)
		const problemStatus = objectValue(statuses[String(row.problem.id)]).status
		if (typeof problemStatus === "number") myStatus = problemStatus

		const [failed] = await db
			.select({ value: count() })
			.from(schema.submission)
			.where(
				and(
					eq(schema.submission.userId, user.id),
					eq(schema.submission.problemId, row.problem.id),
					notInArray(schema.submission.result, [0, 10]),
				),
			)
		myFailedCount = failed?.value ?? 0
	}

	const samples = Array.isArray(row.problem.samples) ? row.problem.samples : []
	const data = problemDetailSchema.parse({
		id: row.problem.id,
		_id: row.problem.displayId,
		title: row.problem.title,
		description: row.problem.description,
		inputDescription: row.problem.inputDescription,
		outputDescription: row.problem.outputDescription,
		samples,
		hint: row.problem.hint,
		languages: stringArray(row.problem.languages),
		template: publicTemplates(row.problem.template),
		createTime: row.problem.createTime,
		lastUpdateTime: row.problem.lastUpdateTime,
		timeLimit: row.problem.timeLimit,
		memoryLimit: row.problem.memoryLimit,
		difficulty: row.problem.difficulty,
		source: row.problem.source,
		prompt: row.problem.prompt,
		submissionNumber: row.problem.submissionNumber,
		acceptedNumber: row.problem.acceptedNumber,
		statisticInfo: objectValue(row.problem.statisticInfo),
		shareSubmission: row.problem.shareSubmission,
		contestId: row.problem.contestId,
		tags: tagRows.map((tag) => tag.name),
		createdBy: {
			id: row.creatorId,
			username: row.creatorUsername,
			realName: null,
		},
		myStatus,
		myFailedCount,
		allowFlowchart: row.problem.allowFlowchart,
		showFlowchart: row.problem.showFlowchart,
		mermaidCode: row.problem.allowFlowchart ? null : row.problem.mermaidCode,
		flowchartData: row.problem.allowFlowchart
			? null
			: objectValue(row.problem.flowchartData),
		flowchartHint: row.problem.flowchartHint,
		sqlConfig: row.problem.sqlConfig ? objectValue(row.problem.sqlConfig) : null,
		sqlDisplay: row.problem.sqlDisplay ? objectValue(row.problem.sqlDisplay) : null,
	})

	return success(c, data)
})
