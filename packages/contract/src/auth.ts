import { z } from "zod"

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(150),
  password: z.string().min(1).max(1024),
})

/** 换 access token、退出登录都拿 refresh token 当凭证 */
export const refreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512),
})

/**
 * WebSocket 握手带 access token 用的子协议名。浏览器的 `new WebSocket()` 设不了请求头，
 * 前端传 `[WS_AUTH_PROTOCOL, token]` 两个子协议，服务端回第一个 —— 必须回一个前端
 * 传过的，否则 Chrome 判握手失败。不放 URL 查询参数：URL 会原样进反代的访问日志。
 */
export const WS_AUTH_PROTOCOL = "oj2.bearer"

/**
 * 登录、换 token 的出参。
 *
 * `expiresIn` 是秒数而不是到期时刻：机房电脑的时钟不一定准，前端拿自己的时钟加上它
 * 算到期，才不会因为差了几分钟一直以为 token 已过期。
 *
 * 换 token 时 `refreshToken` 一般是新轮换出来的一张；同一张刚被别的标签页换掉的话，
 * 回的是那个标签页拿到的那张，见 auth/session.ts 的 REFRESH_GRACE_MS。
 */
export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export const sessionUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  email: z.string().nullable(),
  adminType: z.string(),
  problemPermission: z.string(),
  createTime: z.string().nullable(),
  lastLogin: z.string().nullable(),
  isDisabled: z.boolean(),
  className: z.string().nullable(),
})

export const userProfileSchema = z.object({
  id: z.number().int(),
  user: sessionUserSchema,
  realName: z.string().nullable(),
  acmProblemsStatus: z.record(z.string(), z.unknown()),
  avatar: z.string(),
  mood: z.string().nullable(),
  acceptedNumber: z.number().int(),
  submissionNumber: z.number().int(),
})

export type LoginRequest = z.input<typeof loginRequestSchema>
export type RefreshTokenRequest = z.input<typeof refreshTokenRequestSchema>
export type SessionUser = z.infer<typeof sessionUserSchema>
export type UserProfile = z.infer<typeof userProfileSchema>
