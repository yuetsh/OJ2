import { Hono } from "hono"

import { getRequestSessionUser } from "./auth/session"
import { config } from "./config"
import { authRoutes } from "./routes/auth"
import { judgeServerRoutes } from "./routes/judge-server"
import { problemRoutes } from "./routes/problem"
import { submissionRoutes } from "./routes/submission"
import {
  bridgeSubmissionEvents,
  submissionWebSocketHandler,
  type SubmissionSocketData,
} from "./websocket"

const app = new Hono()

app.get("/health", (c) => c.json({ ok: true }))
app.route("/api", authRoutes)
app.route("/api", problemRoutes)
app.route("/api", submissionRoutes)
app.route("/api", judgeServerRoutes)

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
