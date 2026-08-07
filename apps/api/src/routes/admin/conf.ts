import {
  dashboardInfoSchema,
  judgeServerListSchema,
  judgeServerSchema,
  orphanTestCaseSchema,
  updateJudgeServerRequestSchema,
  updateWebsiteConfigRequestSchema,
  uploadImageResponseSchema,
  websiteConfigSchema,
} from "@oj2/contract"
import { randomInt } from "node:crypto"
import { mkdir, readdir, rm, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { count, desc, eq, gte, ilike, not, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireSuperAdmin, type AppEnv } from "../../auth/middleware"
import { config } from "../../config"
import { db, schema } from "../../db"
import { publishConfigUpdate } from "../../events"
import { failure, success } from "../../http"
import { getWebsiteOptions } from "../../services/options"
import { todayStart } from "../helpers"

export const adminConfRoutes = new Hono<AppEnv>()

/** 心跳 6 秒内算在线，与旧 DashboardInfoAPI 的判活口径一致 */
const HEARTBEAT_ALIVE_SECONDS = 6

function aliveSince() {
  return new Date(Date.now() - HEARTBEAT_ALIVE_SECONDS * 1000).toISOString()
}

/**
 * 判活必须解析成时间再比，不能直接比字符串。
 * 库里取出来的 timestamptz 形如 `2026-08-07 13:42:50.729+00`（空格分隔），
 * 而 toISOString() 是 `2026-08-07T13:42:44.000Z`（T 分隔）。按字典序空格(0x20) < 'T'(0x54)，
 * 于是同一天的心跳永远小于阈值，**所有判题机都会被标成离线**。
 */
function isAlive(lastHeartbeat: string) {
  return Date.parse(lastHeartbeat) >= Date.now() - HEARTBEAT_ALIVE_SECONDS * 1000
}

// ---------------------------------------------------------------- 网站配置

/** camelCase 契约 ←→ options 表里的 snake_case key */
const OPTION_KEYS = {
  websiteBaseUrl: "website_base_url",
  websiteName: "website_name",
  websiteNameShortcut: "website_name_shortcut",
  websiteFooter: "website_footer",
  allowRegister: "allow_register",
  submissionListShowAll: "submission_list_show_all",
  classList: "class_list",
  enableMaxkb: "enable_maxkb",
} as const

adminConfRoutes.get("/website", requireSuperAdmin, async (c) => {
  const options = await getWebsiteOptions()
  return success(c, websiteConfigSchema.parse({
    websiteBaseUrl: options.website_base_url,
    websiteName: options.website_name,
    websiteNameShortcut: options.website_name_shortcut,
    websiteFooter: options.website_footer,
    allowRegister: options.allow_register,
    submissionListShowAll: options.submission_list_show_all,
    classList: options.class_list,
    enableMaxkb: options.enable_maxkb,
  }))
})

adminConfRoutes.post("/website", requireSuperAdmin, async (c) => {
  const parsed = updateWebsiteConfigRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return failure(c, 400, "invalid-request", parsed.error.issues[0]?.message ?? "Invalid payload")
  }
  for (const [field, key] of Object.entries(OPTION_KEYS) as [keyof typeof OPTION_KEYS, string][]) {
    const value = parsed.data[field]
    await db.insert(schema.optionsSysoptions).values({ key, value })
      .onConflictDoUpdate({ target: schema.optionsSysoptions.key, set: { value } })
    // 广播给所有开着页面的人，改完立刻生效不必刷新，对齐旧 push_config_update。
    // 推的是 options 表里的 snake_case key —— 前端 configStore.config 用的就是这套键名。
    await publishConfigUpdate(key, value)
  }
  return success(c, null)
})

// ---------------------------------------------------------------- 判题机

adminConfRoutes.get("/judge-servers", requireSuperAdmin, async (c) => {
  const rows = await db.select().from(schema.judgeServer).orderBy(desc(schema.judgeServer.lastHeartbeat))
  return success(c, judgeServerListSchema.parse({
    // 后台要显示 token 才能拿去配判题机。这个接口是超管专属的
    token: config.judgeServerToken,
    servers: rows.map((row) => judgeServerSchema.parse({
      ...row,
      status: isAlive(row.lastHeartbeat) ? "normal" : "abnormal",
    })),
  }))
})

adminConfRoutes.put("/judge-servers/:id", requireSuperAdmin, async (c) => {
  const parsed = updateJudgeServerRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return failure(c, 400, "invalid-request", "isDisabled is required")
  const updated = await db.update(schema.judgeServer)
    .set({ isDisabled: parsed.data.isDisabled })
    .where(eq(schema.judgeServer.id, Number(c.req.param("id"))))
    .returning({ id: schema.judgeServer.id })
  if (updated.length === 0) return failure(c, 404, "judge-server-not-found", "Judge server does not exist")
  // 旧后端在这里会 process_pending_task() 把积压的待判任务重新分发。
  // 新架构不需要：任务在 BullMQ 里排着，worker 恢复就自己接着消费，不存在「没有新提交
  // 就一直 waiting」那种情况 —— 那是旧的自研分发器才有的问题。
  return success(c, null)
})

adminConfRoutes.delete("/judge-servers/:hostname", requireSuperAdmin, async (c) => {
  const deleted = await db.delete(schema.judgeServer)
    .where(eq(schema.judgeServer.hostname, c.req.param("hostname")))
    .returning({ id: schema.judgeServer.id })
  if (deleted.length === 0) return failure(c, 404, "judge-server-not-found", "Judge server does not exist")
  return success(c, null)
})

// ---------------------------------------------------------------- 孤儿测试用例

const TEST_CASE_ID_RE = /^[a-zA-Z0-9]{32}$/

/** 磁盘上有、但没有任何题目引用的用例目录 */
async function orphanTestCaseIds() {
  const [onDisk, inDb] = await Promise.all([
    readdir(config.testCaseDirectory).catch(() => [] as string[]),
    db.select({ id: schema.problem.testCaseId }).from(schema.problem),
  ])
  const referenced = new Set(inDb.map((row) => row.id))
  return onDisk.filter((name) => TEST_CASE_ID_RE.test(name) && !referenced.has(name))
}

adminConfRoutes.get("/orphan-test-cases", requireSuperAdmin, async (c) => {
  const ids = await orphanTestCaseIds()
  const rows = await Promise.all(ids.map(async (id) => {
    const info = await stat(resolve(config.testCaseDirectory, id)).catch(() => null)
    return orphanTestCaseSchema.parse({ id, createTime: info ? info.mtimeMs / 1000 : 0 })
  }))
  return success(c, rows)
})

adminConfRoutes.delete("/orphan-test-cases", requireSuperAdmin, async (c) => {
  const requested = c.req.query("id")
  const orphans = await orphanTestCaseIds()
  // 指定 id 时也必须先确认它确实是孤儿。否则一个手抖的 id 就能删掉在用题目的测试数据，
  // 而测试数据没有别处备份 —— 旧后端这里是不校验的。
  const targets = requested ? orphans.filter((id) => id === requested) : orphans
  if (requested && targets.length === 0) {
    return failure(c, 404, "not-an-orphan", "该用例目录不存在或仍被题目引用，未删除")
  }
  for (const id of targets) {
    await rm(resolve(config.testCaseDirectory, id), { recursive: true, force: true })
  }
  return success(c, { deleted: targets.length })
})

// ---------------------------------------------------------------- 概览 / 随机点名

adminConfRoutes.get("/dashboard", requireSuperAdmin, async (c) => {
  const now = new Date().toISOString()
  const [[users], [submissions], [contests], [servers]] = await Promise.all([
    db.select({ value: count() }).from(schema.user),
    db.select({ value: count() }).from(schema.submission)
      .where(gte(schema.submission.createTime, todayStart())),
    db.select({ value: count() }).from(schema.contest)
      .where(not(sql`${schema.contest.endTime} < ${now}`)),
    db.select({ value: count() }).from(schema.judgeServer)
      .where(gte(schema.judgeServer.lastHeartbeat, aliveSince())),
  ])
  // 旧接口还回了 env.FORCE_HTTPS / STATIC_CDN_HOST，前端从未读过，不再下发
  return success(c, dashboardInfoSchema.parse({
    userCount: users?.value ?? 0,
    todaySubmissionCount: submissions?.value ?? 0,
    recentContestCount: contests?.value ?? 0,
    judgeServerCount: servers?.value ?? 0,
  }))
})

adminConfRoutes.get("/random-usernames", requireSuperAdmin, async (c) => {
  // 传的是**班级前缀**（形如 ks251），不是班级号 —— 前端输入框写的就是「班级前缀」，
  // 拿到结果后按这个前缀 split 取姓名。这里按前缀匹配，与旧 istartswith 一致，
  // 不额外按 className 过滤：那会改变旧行为，而这个功能就是随机点名，宁可宽松
  const classroom = c.req.query("classroom")?.trim()
  if (!classroom) return failure(c, 400, "invalid-request", "需要班级号")
  const rows = await db.select({ username: schema.user.username }).from(schema.user)
    .where(ilike(schema.user.username, `${classroom}%`))
    .orderBy(sql`random()`).limit(10)
  return success(c, rows.map((row) => row.username))
})

// ---------------------------------------------------------------- 富文本图片上传

const IMAGE_SUFFIXES = [".gif", ".jpg", ".jpeg", ".bmp", ".png"]
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * Simditor 富文本编辑器的图片上传。响应形状是编辑器约定的
 * `{success, msg, filePath}`，不是本项目的 `{data}` 信封 —— 但外面仍然包一层 data，
 * 由前端 api 层解包，这样它和其它接口共用同一个错误处理拦截器。
 */
adminConfRoutes.post("/upload-image", requireSuperAdmin, async (c) => {
  const form = await c.req.formData().catch(() => null)
  const image = form?.get("image")
  if (!(image instanceof File)) {
    return success(c, uploadImageResponseSchema.parse({ success: false, msg: "Upload failed", filePath: "" }))
  }
  const suffix = image.name.slice(image.name.lastIndexOf(".")).toLowerCase()
  if (!IMAGE_SUFFIXES.includes(suffix)) {
    return success(c, uploadImageResponseSchema.parse({ success: false, msg: "Unsupported file format", filePath: "" }))
  }
  // 旧后端没有大小限制，靠 nginx 兜。这里显式限一道：文件写在本地磁盘上，
  // 一个超大文件就能把机房那台机器的盘写满，而写满之后判题也一起挂
  if (image.size > MAX_IMAGE_BYTES) {
    return success(c, uploadImageResponseSchema.parse({ success: false, msg: "图片不能超过 10MB", filePath: "" }))
  }
  // 文件名完全由服务端生成，不带用户提供的任何一段 —— 原名里的 ../ 或空字节都进不来
  const name = `${randomFileName()}${suffix}`
  try {
    await mkdir(config.uploadDirectory, { recursive: true })
    await Bun.write(resolve(config.uploadDirectory, name), image)
  } catch (error) {
    console.error("Failed to save uploaded image", error)
    return success(c, uploadImageResponseSchema.parse({ success: false, msg: "Upload Error", filePath: "" }))
  }
  return success(c, uploadImageResponseSchema.parse({
    success: true,
    msg: "Success",
    filePath: `${config.uploadUriPrefix}/${name}`,
  }))
})

function randomFileName() {
  return Array.from({ length: 10 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789"[randomInt(36)]).join("")
}
