import { toAdminType } from "@oj2/contract"
import type { JudgeCaseResult, JudgeInfo } from "@oj2/contract"
import { getTime, intervalToDuration, parseISO, type Duration } from "date-fns"
import { User } from "./types"
import { USER_TYPE } from "./constants"
import {
  strFromU8,
  strToU8,
  unzlibSync,
  zipSync,
  zlibSync,
  type Zippable,
} from "fflate"
import copyTextFallback from "copy-text-to-clipboard"
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
export function parseTime(utc: Date | string, format = "YYYY年M月D日") {
  const time = useDateFormat(utc, format, { locales: "zh-CN" })
  return time.value
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
