import { Hono } from "hono"

import { problemRoutes } from "./routes/problem"

const app = new Hono()

app.get("/health", (c) => c.json({ ok: true }))
app.route("/api", problemRoutes)

export default {
	port: 3000,
	fetch: app.fetch,
}
