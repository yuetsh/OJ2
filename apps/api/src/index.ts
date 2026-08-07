import { Hono } from "hono"
import { basename, resolve } from "node:path"

import { getRequestSessionUser } from "./auth/session"
import { config } from "./config"
import { adminRoutes } from "./routes/admin"
import { authRoutes } from "./routes/auth"
import { accountRoutes } from "./routes/account"
import { judgeServerRoutes } from "./routes/judge-server"
import { contestRoutes } from "./routes/contest"
import { contentRoutes } from "./routes/content"
import { classroomRoutes } from "./routes/classroom"
import { problemsetRoutes } from "./routes/problemset"
import { achievementRoutes } from "./routes/achievement"
import { aiRoutes } from "./routes/ai"
import { flowchartRoutes } from "./routes/flowchart"
import { problemRoutes } from "./routes/problem"
import { submissionRoutes } from "./routes/submission"
import { siteRoutes } from "./routes/site"
import {
  bridgeSubmissionEvents,
  submissionWebSocketHandler,
  type SubmissionSocketData,
} from "./websocket"

const app = new Hono()

app.get("/health", (c) => c.json({ ok: true }))
app.route("/api", authRoutes)
app.route("/api", accountRoutes)
app.route("/api", siteRoutes)
app.route("/api", contestRoutes)
app.route("/api", contentRoutes)
app.route("/api", classroomRoutes)
app.route("/api", problemsetRoutes)
app.route("/api", achievementRoutes)
app.route("/api", aiRoutes)
app.route("/api", flowchartRoutes)
app.route("/api", problemRoutes)
app.route("/api", submissionRoutes)
app.route("/api", judgeServerRoutes)
app.route("/api/admin", adminRoutes)

app.onError((error, c) => {
	console.error(error)
	return c.json(
		{ error: { code: "internal-error", message: "Internal server error" } },
		500,
	)
})

const server = Bun.serve<SubmissionSocketData>({
	port: config.port,
	async fetch(request, bunServer) {
		const url = new URL(request.url)
		if (url.pathname.startsWith(`${config.avatarUriPrefix}/`)) {
			const filename = basename(decodeURIComponent(url.pathname))
			if (filename !== decodeURIComponent(url.pathname).split("/").at(-1)) {
				return new Response("Not found", { status: 404 })
			}
			const file = Bun.file(resolve(config.avatarDirectory, filename))
			if (await file.exists()) return new Response(file)
			if (filename === "default.png") {
				return new Response(
					'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#e2e8f0"/><circle cx="64" cy="48" r="24" fill="#94a3b8"/><path d="M20 120c4-28 22-42 44-42s40 14 44 42" fill="#94a3b8"/></svg>',
					{ headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } },
				)
			}
			return new Response("Not found", { status: 404 })
		}
		if (url.pathname === "/ws/submissions") {
			const user = await getRequestSessionUser(request)
			if (!user) return new Response("Unauthorized", { status: 401 })
			if (
				bunServer.upgrade(request, {
					data: { userId: user.id, username: user.username },
				})
			) {
				return undefined
			}
			return new Response("WebSocket upgrade failed", { status: 400 })
		}
		return app.fetch(request)
	},
	websocket: submissionWebSocketHandler(),
})

await bridgeSubmissionEvents(server)
console.log(`OJ2 API listening on http://localhost:${server.port}`)
