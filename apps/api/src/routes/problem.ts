import { problemSummarySchema } from "@oj2/contract"
import { desc } from "drizzle-orm"
import { Hono } from "hono"

import { db, schema } from "../db"

export const problemRoutes = new Hono()

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
		.orderBy(desc(schema.problem.id))
		.limit(20)

	const data = rows.map((row) => problemSummarySchema.parse(row))
	return c.json({ data })
})
