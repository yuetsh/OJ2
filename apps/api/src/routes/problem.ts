import { problemDetailSchema, problemSummarySchema } from "@oj2/contract"
import { and, count, desc, eq, isNull, notInArray } from "drizzle-orm"
import { Hono } from "hono"

import { optionalAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, success } from "../http"

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

problemRoutes.get("/problems", async (c) => {
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
