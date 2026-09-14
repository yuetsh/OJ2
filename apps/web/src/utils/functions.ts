import { TIME_ZONE_OFFSET_MINUTES, toAdminType } from "@oj2/contract"
import type { JudgeCaseResult, JudgeInfo } from "@oj2/contract"
import { getTime, intervalToDuration, parseISO, type Duration } from "date-fns"
import { Submission, User } from "./types"
import { JUDGE_STATUS, USER_TYPE } from "./constants"
import {
  strFromU8,
  strToU8,
  unzlibSync,
  zipSync,
  zlibSync,
  type Zippable,
} from "fflate"
import copyTextFallback from "copy-text-to-clipboard"
import { normalizeDate } from "@vueuse/core"
import { customAlphabet } from "nanoid"

function calculateACRate(acCount: number, totalCount: number): string {
  if (totalCount === 0) return "0.00"
  if (acCount >= totalCount) return "100.00"
  return ((acCount / totalCount) * 100).toFixed(2)
}

/**
 * 从 `submission.info` 里取测试点明细，取不到就返回空数组。
 *
 * `info` 在契约里是 `z.unknown()`（判题产物不在读出侧校验，见契约那边的说明），
 * 它有三种真实取值：判题机写的完整形状、**空对象**（后端对非管理员下发的
 * `info: {}`，也是待判提交的初值）、以及 `data: null`（编译失败等没有逐测试点
 * 结果的情形）。三种「没有」在这里一并归成空数组。
 *
 * **这是判题产物在前端唯一需要的运行时判断** —— 有没有 data 数组。数组项的形状
 * 直接信判题机（`JudgeCaseResult`）。
 */
export function submissionCaseResults(info: unknown): JudgeCaseResult[] {
  if (!info || typeof info !== "object" || !("data" in info)) return []
  const data = (info as JudgeInfo).data
  return Array.isArray(data) ? data : []
}

/**
 * 没通过、但已经过了一部分测试点时的进度，其余情况（通过、一个都没过、没有逐点结果）为 null。
 *
 * 一个都没过不给：「通过 0/8」只是把「答案错误」换个更刺眼的说法再说一遍。
 * 全过也不给：AC 用不着；AST_CHECK_FAILED 是测试点全过、语法规则没过，那边有自己的规则清单。
 */
export function submissionPartialCases(
  submission: Pick<Submission, "caseSummary"> | undefined,
) {
  const summary = submission?.caseSummary
  if (!summary || summary.passed === 0 || summary.passed >= summary.total)
    return null
  return summary
}

/** 结果标题：部分测试点通过时缀上「通过 x/y 个测试点」 */
export function submissionResultTitle(
  submission: Pick<Submission, "result" | "caseSummary">,
) {
  const title = JUDGE_STATUS[submission.result]["title"]
  const partial = submissionPartialCases(submission)
  return partial
    ? `${title} · 通过 ${partial.passed}/${partial.total} 个测试点`
    : title
}

export function getACRate(acCount: number, totalCount: number): string {
  return `${calculateACRate(acCount, totalCount)}%`
}

export function getACRateNumber(acCount: number, totalCount: number): number {
  return parseFloat(calculateACRate(acCount, totalCount))
}

export function filterEmptyValue<T extends Record<string, any>>(
  object: T,
): Partial<T> {
  return Object.entries(object).reduce((query, [key, value]) => {
    if (value != null && value !== "" && value !== undefined) {
      query[key as keyof T] = value
    }
    return query
  }, {} as Partial<T>)
}

export function getTagColor(
  tag: "Low" | "Mid" | "High" | "简单" | "中等" | "困难",
) {
  return <"success" | "info" | "error">{
    Low: "success",
    Mid: "info",
    High: "error",
    简单: "success",
    中等: "info",
    困难: "error",
  }[tag]
}

// 2023-04-03T02:43:28.673156Z
/**
 * 把时段选项的 `value`（`"weeks:1"`、`"minutes:10"`）解成 date-fns 的 Duration。
 *
 * 认不出来返回 null —— 「全部时段」那个 `all` 走的就是这条，调用方本来就该在
 * `duration === "all"` 时不带时间条件。原来这段 `split(":")` 在五个组件里各写了一遍
 * （两个统计面板、AI 分析页、榜单页、班级对比页），每份的兜底还都不一样。
 */
export function durationFromValue(
  // 放宽到 SelectOption["value"] 那个形状：这些值直接来自 n-select 的绑定，
  // Naive 那边的类型是 string | number | undefined。数字解不出来，照样回 null
  value: string | number | null | undefined,
): Duration | null {
  const [unit, amount] = String(value ?? "").split(":")
  const count = Number(amount)
  if (!unit || !Number.isFinite(count)) return null
  return { [unit]: count } as Duration
}

const OFFSET_MS = TIME_ZONE_OFFSET_MINUTES * 60_000

const pad2 = (value: number) => String(value).padStart(2, "0")

/**
 * 取一个时刻在东八区的年月日时分秒（数字）。无效日期返回 null。
 *
 * 站内所有时间一律按**东八区**展示、不跟浏览器时区走，口径是契约里的
 * `TIME_ZONE`（和后端 `apps/api/src/time.ts` 同一个常量）。平移固定偏移后读 `getUTC*`，
 * 就是北京的墙上时间。**不要在组件里写 `getFullYear()` / `getMonth()` / `getDate()`**
 * —— 那是浏览器本地部件。
 */
export function zonedParts(value: Date | string) {
  const time = normalizeDate(value).getTime()
  if (Number.isNaN(time)) return null
  const wall = new Date(time + OFFSET_MS)
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
  }
}

/** 东八区的当前年份。跨年那几个小时里它和 `new Date().getFullYear()` 会差一年 */
export function zonedYear() {
  return zonedParts(new Date())!.year
}

/**
 * 按东八区格式化。格式串只认下面这几个 token（站内实际用到的就这些），
 * 其余字符原样输出，所以 `YYYY年M月D日` 这种中英混排也能用。
 *
 * 长度不同的 token 靠正则的**顺序**区分：`YYYY` 必须排在 `M`/`D` 前面，
 * 否则 `MM` 会被拆成两个 `M`。
 */
export function parseTime(utc: Date | string, format = "YYYY年M月D日") {
  const parts = zonedParts(utc)
  if (!parts) return ""
  const table: Record<string, string> = {
    YYYY: String(parts.year),
    MM: pad2(parts.month),
    DD: pad2(parts.day),
    HH: pad2(parts.hour),
    mm: pad2(parts.minute),
    ss: pad2(parts.second),
    M: String(parts.month),
    D: String(parts.day),
  }
  return format.replace(/YYYY|MM|DD|HH|mm|ss|M|D/g, (token) => table[token]!)
}

/**
 * Naive 的 `n-date-picker` 没有 `timezone` 属性，按**浏览器本地**渲染绑定的时间戳，
 * 所以要平移一次再交给它。这两个函数互为逆运算，东八区的机器上是恒等：
 *
 *   toPickerValue(真实时刻)   → 绑给 n-date-picker，本地渲染出来正好是北京墙上时间
 *   fromPickerValue(选择器值) → 换回真实时刻，再 formatISO / 存库
 *
 * ⚠️ **只有 `n-date-picker` 需要这一对。** 显示时间用 `parseTime`，别把平移过的值喂给它。
 */
export function toPickerValue(instant: number) {
  return instant + OFFSET_MS + new Date(instant).getTimezoneOffset() * 60_000
}

export function fromPickerValue(value: number) {
  return value - OFFSET_MS - new Date(value).getTimezoneOffset() * 60_000
}

function getDurationObject(start: Date | string, end: Date | string) {
  return intervalToDuration({
    start: getTime(parseISO(start.toString())),
    end: getTime(parseISO(end.toString())),
  })
}

function formatDurationUnits(
  duration: Duration,
  units: Array<{ key: keyof Duration; suffix: string }>,
): string {
  return units
    .filter(({ key }) => duration[key])
    .map(({ key, suffix }) => duration[key] + suffix)
    .join("")
}

export function duration(
  start: Date | string,
  end: Date | string,
  showSeconds = false,
): string {
  const durationObj = getDurationObject(start, end)
  const units = [
    { key: "years" as const, suffix: "年" },
    { key: "months" as const, suffix: "月" },
    { key: "days" as const, suffix: "天" },
    { key: "hours" as const, suffix: "小时" },
    { key: "minutes" as const, suffix: "分钟" },
    ...(showSeconds ? [{ key: "seconds" as const, suffix: "秒" }] : []),
  ]
  return formatDurationUnits(durationObj, units)
}

/**
 * 自学时长的显示。心跳是 15 秒一跳，本来就精确不到秒，一律按分钟取整；
 * 0 显示成短横线而不是「0 分钟」——「没学过」和「学了不到一分钟」不是一回事。
 */
export function readableDuration(seconds: number): string {
  if (seconds <= 0) return "-"
  if (seconds < 60) return "不到 1 分钟"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

export function durationToDays(
  start: Date | string,
  end: Date | string,
): string {
  const durationObj = getDurationObject(start, end)
  const units = [
    { key: "years" as const, suffix: "年" },
    { key: "months" as const, suffix: "月" },
    { key: "days" as const, suffix: "天" },
  ]
  const result = formatDurationUnits(durationObj, units)
  return result || "一天以内"
}

export function secondsToDuration(seconds: number): string {
  const duration = intervalToDuration({
    start: 0,
    end: seconds * 1000,
  })
  const hours = (duration.days ?? 0) * 24 + (duration.hours ?? 0)
  const pad = (n: number) => String(n).padStart(2, "0")
  return [hours, pad(duration.minutes ?? 0), pad(duration.seconds ?? 0)].join(
    ":",
  )
}

export function submissionMemoryFormat(memory: number | string | undefined) {
  if (memory === undefined) return "--"
  // 1048576 = 1024 * 1024
  let t = parseInt(memory + "") / 1048576
  return String(t.toFixed(0)) + "MB"
}

export function submissionTimeFormat(time: number | string | undefined) {
  if (time === undefined) return "--"
  return time + "ms"
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay = 100,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

export function getUserRole(role: User["adminType"]): {
  type: "default" | "info" | "warning" | "error"
  label: "普通" | "生管" | "师管" | "超管"
} {
  const roleMap = {
    [USER_TYPE.REGULAR_USER]: {
      type: "default" as const,
      label: "普通" as const,
    },
    [USER_TYPE.STUDENT_ADMIN]: {
      type: "info" as const,
      label: "生管" as const,
    },
    [USER_TYPE.TEACHER_ADMIN]: {
      type: "warning" as const,
      label: "师管" as const,
    },
    [USER_TYPE.SUPER_ADMIN]: {
      type: "error" as const,
      label: "超管" as const,
    },
  }

  // role 是从接口来的裸字符串，toAdminType 把认不出来的值归到「普通」，
  // 归一逻辑和后端共用同一个函数（@oj2/contract 的 roles.ts）
  return roleMap[toAdminType(role)]
}

export function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

export function encode(string?: string): string {
  try {
    return btoa(String.fromCharCode(...new TextEncoder().encode(string ?? "")))
  } catch (error) {
    console.error("编码失败:", error)
    return ""
  }
}

export function decode(bytes?: string): string {
  try {
    if (!bytes) return ""
    const latin = atob(bytes)
    return new TextDecoder("utf-8").decode(
      Uint8Array.from({ length: latin.length }, (_, index) =>
        latin.charCodeAt(index),
      ),
    )
  } catch (error) {
    console.error("解码失败:", error)
    return ""
  }
}

export function utoa(data: string): string {
  const buffer = strToU8(data)
  const zipped = zlibSync(buffer, { level: 9 })
  const binary = strFromU8(zipped, true)
  return btoa(binary)
}

export function atou(base64: string): string {
  const binary = atob(base64)
  const buffer = strToU8(binary, true)
  const unzipped = unzlibSync(buffer)
  return strFromU8(unzipped)
}

/**
 * 把若干文本文件打包成 zip Blob
 * @param files 文件名和文本内容
 * @param mtime 归档内的修改时间，默认当前时间
 */
export function createZipBlob(
  files: { name: string; content: string }[],
  mtime: Date = new Date(),
): Blob {
  const entries: Zippable = {}
  for (const f of files) {
    entries[f.name] = strToU8(f.content)
  }
  return new Blob([zipSync(entries, { mtime })], { type: "application/zip" })
}

/**
 * 复制文本到剪贴板
 * 优先使用 Clipboard API（支持在 modal 中使用），失败时回退到 copy-text-to-clipboard
 * @param text 要复制的文本
 * @returns Promise<boolean> 复制是否成功
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 优先使用现代 Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (error) {
      console.warn("Clipboard API 复制失败，尝试使用回退方法:", error)
    }
  }

  // 回退到 copy-text-to-clipboard
  try {
    const success = copyTextFallback(text)
    return success
  } catch (error) {
    console.error("复制失败:", error)
    return false
  }
}

export function getRandomId() {
  const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz")
  return nanoid()
}
