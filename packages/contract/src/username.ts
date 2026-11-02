import { z } from 'zod'

/**
 * 班级号：3～4 位数字（`232` = 23 级 2 班，`2311` = 23 级 11 班）。存在 `user.class_name`，
 * 全站认班级只认这一列。
 */
export const CLASS_NAME_MIN_DIGITS = 3
export const CLASS_NAME_MAX_DIGITS = 4
export const CLASS_NAME_RE = new RegExp(`^\\d{${CLASS_NAME_MIN_DIGITS},${CLASS_NAME_MAX_DIGITS}}$`)
export const classNameSchema = z.string().trim().regex(CLASS_NAME_RE, `班级号要是 ${CLASS_NAME_MIN_DIGITS}～${CLASS_NAME_MAX_DIGITS} 位数字`)

/**
 * 老账号的用户名带着班级：`ks232张三`（ks 是「考试」的拼音缩写）。2026-11 起新建的号不再带，
 * 用户名就是名字；老账号不改名（学生要换登录名、历史提交里存着当时的用户名），只是界面上不再露出这段。
 *
 * 这条正则是**唯一**还认 `ks` 的地方：显示名、登录名单、建号查重都从这里剥。新号是中文名，不会误中。
 */
export const LEGACY_CLASS_PREFIX_RE = new RegExp(`^ks\\d{${CLASS_NAME_MIN_DIGITS},${CLASS_NAME_MAX_DIGITS}}`, 'i')

/** 界面上显示的名字：老号剥掉 `ks232`，新号原样。剥完是空串的（只有前缀的怪号）退回原名 */
export function displayName(username: string) {
  return username.replace(LEGACY_CLASS_PREFIX_RE, '') || username
}

/**
 * 老号用户名里的班号（`ks232张三` → `232`），只给**没明确给班级**的旧调用方兜底（老页面、手粘的 ks 名单）。
 * 位数不对返回 undefined，不猜 —— `ks251001` 猜成 2510 班比报错更糟
 */
export function legacyClassOf(username: string): string | null | undefined {
  const matched = /^ks(\d+)/i.exec(username)
  if (!matched) return null
  const digits = matched[1]!
  return CLASS_NAME_RE.test(digits) ? digits : undefined
}

/**
 * 登录框点名字用的名单（`GET /classes/:className/members`）：`name` 是点的那个名字，
 * `username` 是拿去登录的。原来只回名字、前端拼 `ks` + 班号 + 名字去登录，新号不带前缀就拼错了
 */
export const classMemberSchema = z.object({ name: z.string(), username: z.string() })
export type ClassMember = z.infer<typeof classMemberSchema>
