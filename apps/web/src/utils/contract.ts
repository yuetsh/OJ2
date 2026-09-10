import type { z } from "zod"

/**
 * 契约的运行时闸门。**只挂在三条路径上**：题目详情、提交详情、用户资料
 * （`shared/api.ts` 的 getProfile）—— 也就是原本就写了 `.parse()` 的那三处。
 *
 * ## 为什么只有三处
 *
 * 前后端同仓、同一次编译、共享同一份 schema，「后端改字段前端不知道」这种漂移
 * `tsc` 已经抓了，改了对不上当场编译不过。这里能多抓到的只有一种：**schema 与
 * 库里 JSONB 原文不符**，而那不是契约漂移，是 schema 写错了 —— 而且它的真相在
 * 写入侧，不是在这里。
 *
 * 曾经把它铺到 41 个端点上，收益是 41 次 safeParse 加一个没人读的 console.error；
 * 判题产物那次收紧还因此让 7.4% 的提交静默丢了测试点明细。所以退回三处。
 *
 * ## 留着这三处的理由是「别抛错」，不是「校验」
 *
 * 这三条原来是 `schema.parse(v) as T` —— `as` 把校验结果又断言回本地类型，等于
 * 没校验；而 `parse` 抛出的 ZodError 会打断整个 async 函数，一失败就是白屏。
 * 面向学生的生产站点，少一个字段页面照样能用，整页崩掉不行。所以这里：
 * 记一条带端点和字段路径的 `console.error`，然后**返回原始数据**。
 */
export function contract<T extends z.ZodType>(
  endpoint: string,
  schema: T,
  value: unknown,
): z.infer<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data

  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(根)"}: ${issue.message}`)
    .join("；")
  const more =
    result.error.issues.length > 5
      ? `；另有 ${result.error.issues.length - 5} 处`
      : ""
  console.error(
    `[契约] ${endpoint} 的响应不符合契约 —— ${issues}${more}\n` +
      "  已放行原始数据（页面照常渲染）。契约在 packages/contract/src/。",
  )
  // 放行原始数据。断言在这里是**有意的**：形状确实可能不符，但调用方需要的是
  // 「能渲染的东西」而不是一个异常，分歧已经通过上面那条日志暴露出来了。
  return value as z.infer<T>
}
