import { randomBytes, timingSafeEqual } from 'node:crypto'

import { toAdminType, toProblemPermission, type AdminType, type AuthTokens, type ProblemPermission, WS_AUTH_PROTOCOL } from '@oj2/contract'

import { eq, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { sign, verify } from 'hono/jwt'

import { config } from '../config'
import { db, schema } from '../db'
import { publishSessionRevoked, type SessionRevokedReason } from '../events'
import { clearOnline, markOnline } from './presence'
import { redis } from '../redis'

/**
 * 登录态是两张 token：
 *
 * - **access token**：JWT（HS256），走 `Authorization: Bearer`，15 分钟。
 *   载荷是 `{ uid, sid, ver }`：用户 id、会话 id、签发时用户的 token_version。
 * - **refresh token**：`<sid>.<随机串>`，不透明，7 天（`SESSION_TTL_SECONDS`），
 *   每换一次 access token 就轮换一次，有效期跟着往后顺延 —— 和原来 cookie 会话
 *   「七天不来才过期」是同一个口径。
 *
 * 会话本体仍然在 Redis 的 `auth-session:<sid>` 里（refresh token、上次登录时刻），所以这不是「无状态 JWT」：每个请求验完签名还要确认会话还在、
 * token_version 没变。原因是这几件事必须**立刻**生效，等 access token 自然过期不行：
 *
 * - 退出登录 —— 删掉会话，同一张 access token 下一个请求就不认了；
 * - 改密码、重置密码、禁用账号 —— 学生密码是明文存着给老师查的，改密码是发现泄露
 *   之后唯一的补救手段，晚 15 分钟生效等于给盗号的人留 15 分钟。
 *
 * 这两道检查本来就在每个请求的路上（原来就要查一次用户表看禁没禁用、一次 Redis
 * 续会话），没有多出往返。
 */

const SESSION_PREFIX = 'auth-session:'
/**
 * 输过的比赛密码，一张会话一个 hash（field = 比赛 id）。不塞进会话本体：
 * 会话本体每换一次 token 就整份重写一次，两边一起读改写会互相冲掉。
 */
const CONTEST_PASSWORD_PREFIX = 'auth-contest:'

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60

/**
 * 换 token 的宽限期。refresh token 每用一次就轮换，而同一个浏览器里几个标签页共用
 * localStorage 里的同一张：两个标签页前后脚去换，后到的那个拿着的已经是旧的了。
 * 机房走 http，没有安全上下文，`navigator.locks` 用不了，前端没法让它们排队，
 * 只能在这里放一手 —— 刚被换掉的上一张在这段时间里拿来换，回的是**当前那张**，
 * 几个标签页最后落到同一张上。响应丢了（换成功了但前端没收到）、前端拿旧的重试，
 * 也是这一支接住。
 */
const REFRESH_GRACE_MS = 60_000

/**
 * JWT 的签名密钥存在本站的 Redis 里，第一次启动时生成。
 *
 * 不走环境变量：两个站点各有各的 Redis，密钥自然各是各的；部署时不用往两台机器的
 * env 文件里各补一行，漏了也不会起不来。要让全站所有人重新登录，删掉这个 key
 * 再重启 api 即可。
 */
const JWT_SECRET_KEY = 'auth:jwt-secret'
let jwtSecret: string | null = null

export async function loadJwtSecret() {
  await redis.set(JWT_SECRET_KEY, randomBytes(48).toString('base64url'), 'NX')
  jwtSecret = await redis.get(JWT_SECRET_KEY)
  if (!jwtSecret) throw new Error('JWT 密钥没能写进 Redis')
}

function secret() {
  if (!jwtSecret) throw new Error('JWT 密钥还没加载，入口要先 await loadJwtSecret()')
  return jwtSecret
}

interface StoredSession {
  userId: number
  /**
   * 登录那一刻用户的 token_version。换 token 时和库里比，对不上就不给换 ——
   * 不然改完密码，旧会话拿 refresh token 照样能换出一张带新版本号的 access token
   */
  tokenVersion: number
  /**
   * 当前那张 refresh token 的随机部分。存原文而不是哈希：宽限期里要把它原样交给
   * 后到的标签页（见 REFRESH_GRACE_MS）。这不比存哈希更危险 —— JWT 的签名密钥就在
   * 同一个 Redis 里，读得到这里的人本来就能签出任何人的 access token。
   */
  refreshSecret: string
  /** 上一张，宽限期内仍然认 */
  previousRefreshSecret: string | null
  /** 上一次轮换的毫秒时刻 */
  rotatedAt: number
  createdAt: string
  previousLogin: string | null
}

interface AccessClaims {
  uid: number
  sid: string
  ver: number
}

/**
 * 会话里的用户。`adminType` / `problemPermission` 是**联合类型而不是 string** ——
 * 全仓二十多处 `user.adminType === "Super Admin"` 靠它兜底，拼错一个字母就编译不过。
 * 收窄发生在下面读库那一处，是整个后端唯一一个把裸字符串变成角色的地方。
 */
export interface AuthUser {
  id: number
  username: string
  email: string | null
  adminType: AdminType
  problemPermission: ProblemPermission
  isDisabled: boolean
  className: string | null
}

function sessionKey(sid: string) {
  return `${SESSION_PREFIX}${sid}`
}

/** 等长才比，比的时候不按字节提前退出 */
function sameSecret(a: string, b: string | null) {
  if (b === null || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** `<sid>.<随机串>` 拆开。格式不对返回 null */
function splitRefreshToken(token: string) {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  return { sid: token.slice(0, dot), secret: token.slice(dot + 1) }
}

/** 连原始 JSON 一起返回：轮换时拿它做比对再写入，见 refreshTokens */
async function readSessionRaw(sid: string) {
  const raw = await redis.get(sessionKey(sid))
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as StoredSession
    value.previousLogin ??= null
    return { raw, value }
  } catch {
    await redis.del(sessionKey(sid))
    return null
  }
}

async function readSession(sid: string) {
  return (await readSessionRaw(sid))?.value ?? null
}

/**
 * 会话还是读出来时那一份才写入，被别人改过就不写、返回 false。
 * GET 和 SET 之间隔着一次查库，两个标签页同时换 token 完全可能都读到同一份 ——
 * 不拦的话两边各轮换出一张，后写的把先写的冲掉，手里拿着被冲掉那张的标签页
 * 15 分钟后就换不动了。
 */
const COMPARE_AND_SET = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
  return 1
end
return 0`

async function compareAndSetSession(sid: string, expected: string, value: StoredSession) {
  const result = await redis.eval(COMPARE_AND_SET, 1, sessionKey(sid), expected, JSON.stringify(value), config.sessionTtlSeconds)
  return result === 1
}

async function signAccessToken(claims: AccessClaims) {
  const now = Math.floor(Date.now() / 1000)
  return sign({ ...claims, iat: now, exp: now + ACCESS_TOKEN_TTL_SECONDS }, secret(), 'HS256')
}

/** 验签名和有效期，载荷形状不对也当无效。不碰 Redis 和库 */
async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const payload = await verify(token, secret(), 'HS256')
    const { uid, sid, ver } = payload
    if (!Number.isInteger(uid) || typeof sid !== 'string' || !Number.isInteger(ver)) return null
    return { uid: uid as number, sid, ver: ver as number }
  } catch {
    return null
  }
}

async function selectUser(userId: number) {
  const [user] = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      email: schema.user.email,
      adminType: schema.user.adminType,
      problemPermission: schema.user.problemPermission,
      isDisabled: schema.user.isDisabled,
      className: schema.user.className,
      tokenVersion: schema.user.tokenVersion,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
  return user ?? null
}

export async function issueTokens(userId: number, tokenVersion: number, previousLogin: string | null = null): Promise<AuthTokens> {
  const sid = randomBytes(16).toString('base64url')
  const refreshSecret = randomBytes(32).toString('base64url')
  const value: StoredSession = {
    userId,
    tokenVersion,
    refreshSecret,
    previousRefreshSecret: null,
    rotatedAt: Date.now(),
    createdAt: new Date().toISOString(),
    previousLogin,
  }
  // 两条写进一个 pipeline：一个班四十号人同时登录时，两趟往返和一趟的差别
  // 全压在登录这一下上
  const pipeline = redis.pipeline().set(sessionKey(sid), JSON.stringify(value), 'EX', config.sessionTtlSeconds)
  markOnline(pipeline, userId)
  await pipeline.exec()
  return {
    accessToken: await signAccessToken({ uid: userId, sid, ver: tokenVersion }),
    refreshToken: `${sid}.${refreshSecret}`,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  }
}

export type RefreshResult = { tokens: AuthTokens; reason?: undefined } | { tokens: null; reason: 'invalid' | 'disabled' }

/**
 * 拿 refresh token 换一张新的 access token，同时轮换 refresh token。
 *
 * 认不出来的（伪造的、已经轮换过且出了宽限期的）只是拒掉，**不**顺手删会话：
 * 「旧 token 被重放 = 被盗，整个会话作废」是教科书做法，可这里旧 token 被重放
 * 更常见的原因是网络慢、两个标签页撞车，为此把学生踢下线代价太大。
 */
export async function refreshTokens(refreshToken: string): Promise<RefreshResult> {
  const parts = splitRefreshToken(refreshToken)
  if (!parts) return { tokens: null, reason: 'invalid' }

  // 比对再写入失败（别的标签页抢先轮换了）就重读一遍，这时手里这张已经是「上一张」，
  // 第二轮走宽限期。三轮还落不了地只可能是被刷，直接拒
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await readSessionRaw(parts.sid)
    if (!stored) return { tokens: null, reason: 'invalid' }
    const session = stored.value

    const current = sameSecret(parts.secret, session.refreshSecret)
    const inGrace = !current && sameSecret(parts.secret, session.previousRefreshSecret) && Date.now() - session.rotatedAt < REFRESH_GRACE_MS
    if (!current && !inGrace) return { tokens: null, reason: 'invalid' }

    const user = await selectUser(session.userId)
    if (!user || user.tokenVersion !== session.tokenVersion) {
      await redis.del(sessionKey(parts.sid))
      return { tokens: null, reason: 'invalid' }
    }
    if (user.isDisabled) {
      await redis.del(sessionKey(parts.sid))
      return { tokens: null, reason: 'disabled' }
    }

    const accessToken = await signAccessToken({
      uid: user.id,
      sid: parts.sid,
      ver: user.tokenVersion,
    })
    // 宽限期：不再轮换，把当前那张交出去，几个标签页落到同一张上
    if (inGrace) {
      return {
        tokens: {
          accessToken,
          refreshToken: `${parts.sid}.${session.refreshSecret}`,
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
      }
    }

    const refreshSecret = randomBytes(32).toString('base64url')
    const rotated = await compareAndSetSession(parts.sid, stored.raw, {
      ...session,
      refreshSecret,
      previousRefreshSecret: session.refreshSecret,
      rotatedAt: Date.now(),
    })
    if (rotated) {
      return {
        tokens: {
          accessToken,
          refreshToken: `${parts.sid}.${refreshSecret}`,
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
      }
    }
  }
  return { tokens: null, reason: 'invalid' }
}

/**
 * 退出登录：删掉 refresh token 对应的那张会话。返回会话 id，调用方要拿它去广播吊销，
 * 好断掉同一浏览器里其他标签页的 WebSocket。token 不对（伪造、已过期）返回 null。
 *
 * 要核对随机部分，不能只认 sid：sid 就写在 access token 的载荷里，谁都能解出来。
 */
export async function destroySession(refreshToken: string) {
  const parts = splitRefreshToken(refreshToken)
  if (!parts) return null
  const session = await readSession(parts.sid)
  if (!session) return null
  if (!sameSecret(parts.secret, session.refreshSecret) && !sameSecret(parts.secret, session.previousRefreshSecret)) {
    return null
  }
  await redis.del(sessionKey(parts.sid), `${CONTEST_PASSWORD_PREFIX}${parts.sid}`)
  await clearOnline(session.userId)
  return parts.sid
}

/**
 * 让一个用户所有设备上的登录立刻失效，并广播给还挂着的 WebSocket。
 *
 * 做法是把库里的 token_version 加一：每个请求、每次换 token 都会拿它和 access token
 * 里签的 `ver` 比，对不上就不认。不去 Redis 里挨个删会话 —— 删得掉的只有本站的，
 * 另一个站点的会话在它自己的 Redis 里。
 *
 * 光广播是不够的：`publishSessionRevoked` 只断 WebSocket，HTTP 请求照样能拿着
 * 那张 token 继续用。改密码之后旧密码登出来的会话必须立刻失效，否则「改密码」
 * 对已经被别人登着的账号毫无作用 —— 而学生密码是明文存着给老师查的，
 * 改密码正是发现密码泄露之后唯一的补救手段。
 */
export async function revokeUserSessions(userId: number, reason: SessionRevokedReason) {
  await db
    .update(schema.user)
    .set({ tokenVersion: sql`${schema.user.tokenVersion} + 1` })
    .where(eq(schema.user.id, userId))
  await clearOnline(userId)
  await publishSessionRevoked({ userId }, reason)
}

/**
 * 会话解析结果。之所以不只返回 `AuthUser | null`：拿不到用户有三种原因，
 * 而它们对应完全不同的前端行为 ——
 *
 * - `anonymous`：根本没带 token，该当游客就当游客；
 * - `expired`：带了 token 但不能用（过期、被吊销、伪造），前端该先拿 refresh token
 *   换一张再重试，换不到才算没登录；
 * - `disabled`：账号被禁用，该说「账号已禁用」，不能弹登录框。
 */
export type SessionResult =
  | { user: AuthUser; sid: string; tokenVersion: number; reason?: undefined }
  | { user: null; reason: 'anonymous' | 'expired' | 'disabled' }

async function authenticateToken(token: string | null): Promise<SessionResult> {
  if (!token) return { user: null, reason: 'anonymous' }
  const claims = await verifyAccessToken(token)
  if (!claims) return { user: null, reason: 'expired' }

  // 会话还在不在、用户还在不在，两件事并行问。EXPIRE 顺手给会话续期：
  // 不发 refresh 的请求也该算活动
  const [alive, user] = await Promise.all([redis.expire(sessionKey(claims.sid), config.sessionTtlSeconds), selectUser(claims.uid)])
  if (alive !== 1 || !user || user.tokenVersion !== claims.ver) {
    return { user: null, reason: 'expired' }
  }
  if (user.isDisabled) return { user: null, reason: 'disabled' }

  // 在线状态就是搭在每个带鉴权的请求上记的，见 presence.ts
  const online = redis.pipeline()
  markOnline(online, user.id)
  await online.exec()
  // 唯一的收窄点。库里是 text 列，认不出来的值降成最低权限，见 toAdminType 的注释。
  const { tokenVersion, ...rest } = user
  return {
    user: {
      ...rest,
      adminType: toAdminType(user.adminType),
      problemPermission: toProblemPermission(user.problemPermission),
    },
    sid: claims.sid,
    tokenVersion,
  }
}

function bearerToken(header: string | null | undefined) {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match?.[1] ?? null
}

/** 中间件用这个：要区分「没登录」「token 不能用」「已被禁用」 */
export function resolveSession(c: Context) {
  return authenticateToken(bearerToken(c.req.header('authorization')))
}

/** WebSocket 握手：access token 借子协议带过来，见契约里 WS_AUTH_PROTOCOL 的注释 */
export async function authenticateWebSocket(request: Request) {
  const protocols = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map((value) => value.trim())
  if (protocols[0] !== WS_AUTH_PROTOCOL) return null
  const result = await authenticateToken(protocols[1] || null)
  return result.user ? result : null
}

/**
 * 会话还在就续期、记一笔在线并返回 true，已登出或已过期返回 false。
 *
 * WebSocket 用：握手时校验过一次，可这条连接能挂上好几个小时。只开着页面挂 WebSocket
 * 的人一次请求都不发，不该因此被算成不活跃踢下线，所以这里也续期。
 *
 * 只查 Redis 不查库：每条订阅消息都要过一遍，热路径。token_version 和禁用由
 * websocket.ts 的 sweepSessions 每 60 秒统一对一次库。
 */
export async function touchSession(sid: string, userId: number) {
  if (!sid) return false
  const pipeline = redis.pipeline().expire(sessionKey(sid), config.sessionTtlSeconds)
  // 只挂着 WebSocket 不发请求的人，在线状态全靠这里（sweepSessions 每 60 秒一轮）
  markOnline(pipeline, userId)
  const results = await pipeline.exec()
  return results?.[0]?.[1] === 1
}

/** 当前请求那张 access token 的载荷，验不过返回 null */
async function requestClaims(c: Context) {
  const token = bearerToken(c.req.header('authorization'))
  return token ? verifyAccessToken(token) : null
}

/**
 * 比赛密码、上次登录时刻这几个读写点不一定挂了鉴权中间件，所以自己再验一遍
 * access token（只是一次 HMAC，不碰库）。
 */
export async function setContestPassword(c: Context, contestId: number, password: string) {
  const claims = await requestClaims(c)
  if (!claims) return false
  const key = `${CONTEST_PASSWORD_PREFIX}${claims.sid}`
  await redis.pipeline().hset(key, String(contestId), password).expire(key, config.sessionTtlSeconds).exec()
  return true
}

export async function getContestPassword(c: Context, contestId: number) {
  const claims = await requestClaims(c)
  if (!claims) return null
  return redis.hget(`${CONTEST_PASSWORD_PREFIX}${claims.sid}`, String(contestId))
}

/** 上次登录、这次登录的时刻 —— 首页「上次来」卡的窗口就是这两个之间 */
export async function getLoginWindow(c: Context) {
  const claims = await requestClaims(c)
  const session = claims && (await readSession(claims.sid))
  if (!session) return null
  return { previousLogin: session.previousLogin, loginAt: session.createdAt }
}
