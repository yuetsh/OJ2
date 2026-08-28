import { Hono } from "hono"
import { basename, resolve } from "node:path"

import { getRequestSessionUser, readRequestSessionToken } from "./auth/session"
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
  isAllowedWebSocketOrigin,
  startSessionSweep,
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

/** 头像取不到时的占位图，避免每个没设头像的学生都打一次 404 */
const DEFAULT_AVATAR_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#e2e8f0"/><circle cx="64" cy="48" r="24" fill="#94a3b8"/><path d="M20 120c4-28 22-42 44-42s40 14 44 42" fill="#94a3b8"/></svg>'

/**
 * 伺服 /public 下的用户上传文件。
 *
 * 只取路径最后一段并要求它和原样一致 —— `..`、子目录、编码过的斜杠都会在这里被拒，
 * 拼接进 resolve() 的永远只是一个纯文件名。
 *
 * 生产环境这些请求也走后端（Caddy 把 /public/* 整段反代过来），不让 Caddy 直接读盘：
 * 这样开发（Vite 代理）和生产是同一条代码路径，少一处只在服务器上才出错的差异。
 */
async function serveUpload(pathname: string, prefix: string, directory: string) {
	const decoded = decodeURIComponent(pathname)
	const filename = basename(decoded)
	if (!filename || filename !== decoded.slice(prefix.length + 1)) {
		return new Response("Not found", { status: 404 })
	}
	const file = Bun.file(resolve(directory, filename))
	if (await file.exists()) {
		// 文件名由后端生成且内容不变，可以放心长缓存
		return new Response(file, { headers: { "cache-control": "public, max-age=86400" } })
	}
	return null
}

const server = Bun.serve<SubmissionSocketData>({
	port: config.port,
	async fetch(request, bunServer) {
		const url = new URL(request.url)
		if (url.pathname.startsWith(`${config.avatarUriPrefix}/`)) {
			const hit = await serveUpload(url.pathname, config.avatarUriPrefix, config.avatarDirectory)
			if (hit) return hit
			if (basename(decodeURIComponent(url.pathname)) === "default.png") {
				return new Response(DEFAULT_AVATAR_SVG, {
					headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" },
				})
			}
			return new Response("Not found", { status: 404 })
		}
		// 题面里插的图片。原来没有这一段 —— 后台上传成功、返回 /public/upload/xxx，
		// 但没有任何路由伺服它，题面图片一律 404。
		if (url.pathname.startsWith(`${config.uploadUriPrefix}/`)) {
			return (
				(await serveUpload(url.pathname, config.uploadUriPrefix, config.uploadDirectory)) ??
				new Response("Not found", { status: 404 })
			)
		}
		if (
			url.pathname === "/ws/submissions" ||
			url.pathname === "/ws/config" ||
			url.pathname === "/ws/collab"
		) {
			if (!isAllowedWebSocketOrigin(request.headers.get("origin"), url)) {
				return new Response("Forbidden", { status: 403 })
			}
			const user = await getRequestSessionUser(request)
			if (!user) return new Response("Unauthorized", { status: 401 })
			const kind =
				url.pathname === "/ws/config"
					? "config"
					: url.pathname === "/ws/collab"
						? "collab"
						: "submissions"
			if (
				bunServer.upgrade(request, {
					data: {
						userId: user.id,
						kind,
						token: readRequestSessionToken(request),
						username: user.username,
						adminType: user.adminType,
					},
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
startSessionSweep()
console.log(`OJ2 API listening on http://localhost:${server.port}`)
