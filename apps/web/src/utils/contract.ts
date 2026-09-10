import type { z } from "zod"

/**
 * 契约的运行时闸门。
 *
 * ## 为什么要有这一层
 *
 * `@oj2/contract` 的收益只有一半是类型：`z.infer` 给出编译期的形状，但**编译期
 * 管不了后端实际下发了什么**。改后端字段、drizzle 改名、序列化时漏一个键，
 * TypeScript 一概看不见，页面上表现为某个 `undefined` 静默渲染成空白。
 * 契约真正的价值在于同一份 schema 能在运行时把这种分歧当场抓出来。
 *
 * 原来只有三处调用 `.parse()`，而且**后面都紧跟一个 `as`** 把它重新断言回本地
 * 类型（`problemDetailSchema.parse(v) as Problem`）—— 校验结果被丢弃，等于没校验。
 *
 * ## 失败策略：记日志 + 放行原始数据
 *
 * **不抛错。** 这是面向学生的生产站点，契约分歧的代价不该是白屏 —— 少了哪个
 * 字段，页面大体上照样能用，只是那处空着。所以解析失败时：
 *
 * 1. `console.error` 一条带端点和字段路径的记录，开发时一眼能看到；
 * 2. 记进 `window.__OJ2_CONTRACT_DRIFT__`（同一条只记一次），排查线上问题时
 *    可以直接在控制台敲这个变量看全部历史；
 * 3. **返回原始数据**，让页面继续渲染。
 *
 * 用 `safeParse` 而不是 `parse`：`parse` 抛出的 ZodError 会把调用方整个 async
 * 函数打断，`getProblem` 一失败，整个题目页就只剩白屏。
 *
 * ## 什么时候该升级成硬失败
 *
 * 等 `__OJ2_CONTRACT_DRIFT__` 在某条路径上稳定为空之后，那条路径就可以换成
 * 直接 `schema.parse()` —— 分歧修完了，剩下的任何分歧都是新引入的真 bug，
 * 那时白屏反而是对的。**在那之前不要硬失败**，机房上课时炸一个页面比字段空着严重得多。
 */

/**
 * 见过的分歧。只留前若干条实例，避免一个列表接口几百条记录把内存堆满 ——
 * 每条记录的形状问题是一样的，一条实例足够定位。
 */
interface DriftReport {
  /** 请求路径，带参数，方便直接复现 */
  endpoint: string
  /** zod 的 issue 摘要：路径 + 原因，多条用分号连 */
  detail: string
  /** 实际收到的数据。截断后的原始值，用来判断是字段缺失还是类型不同 */
  received: unknown
  /** 出现次数。同一个端点同一个 detail 只记一条，这里累加 */
  count: number
}

const MAX_REPORTS = 200
const MAX_RECEIVED_CHARS = 2000

declare global {
  interface Window {
    __OJ2_CONTRACT_DRIFT__?: DriftReport[]
  }
}

function collectDrift(endpoint: string, detail: string, received: unknown) {
  if (typeof window === "undefined") return
  const reports = (window.__OJ2_CONTRACT_DRIFT__ ??= [])

  // 同一个端点 + 同一个原因只记一条，累加次数。列表接口一次几百条记录，
  // 不去重的话控制台会被同一句话刷屏，真正的新问题反而看不见。
  const existing = reports.find(
    (item) => item.endpoint === endpoint && item.detail === detail,
  )
  if (existing) {
    existing.count += 1
    return
  }

  if (reports.length >= MAX_REPORTS) return
  reports.push({
    endpoint,
    detail,
    received: truncate(received),
    count: 1,
  })
}

/** 原始数据可能是一整个列表页，原样留着会占住大量内存；只用来判断形状，够看前 2KB 了 */
function truncate(value: unknown) {
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return value
    return text.length <= MAX_RECEIVED_CHARS
      ? value
      : `${text.slice(0, MAX_RECEIVED_CHARS)}…（截断，共 ${text.length} 字符）`
  } catch {
    return String(value)
  }
}

function describe(error: z.ZodError, endpoint: string) {
  const issues = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(根)"
    return `${path}: ${issue.message}`
  })
  const more = error.issues.length > 5 ? `；另有 ${error.issues.length - 5} 处` : ""
  return `${endpoint} 的响应不符合契约 —— ${issues.join("；")}${more}`
}

/**
 * 校验并返回响应。用 `unknown` 进来的数据出去就是契约类型，不需要再 `as`。
 *
 * ```ts
 * const data = await api.get<unknown>("problems", { params })
 * return contract("GET /problems", problemListSchema, data)
 * ```
 *
 * 端点字符串是手写的，刻意不让调用方漏掉 —— 它只用于日志和去重，写错不影响正确性。
 */
export function contract<T extends z.ZodType>(
  endpoint: string,
  schema: T,
  value: unknown,
): z.infer<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data

  collectDrift(endpoint, describe(result.error, endpoint), value)
  console.error(
    `[契约] ${describe(result.error, endpoint)}\n` +
      "  已放行原始数据（页面照常渲染）。全部历史分歧见 window.__OJ2_CONTRACT_DRIFT__。\n" +
      "  契约在 packages/contract/src/，后端对不上的字段在 apps/api/src/routes/。",
  )
  // 放行原始数据。断言在这里是**有意的**：形状确实可能不符，但调用方需要的是
  // 「能渲染的东西」而不是一个异常；分歧已经通过上面两条记录暴露出来了。
  return value as z.infer<T>
}
