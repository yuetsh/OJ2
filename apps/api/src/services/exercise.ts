import { exerciseDataByType, type ExerciseType } from "@oj2/contract"

/**
 * 练习题 `data` 的校验。**这是唯一的校验点** —— 契约里 `data` 是
 * `z.record(z.string(), z.unknown())`，七种题型的字段完全不同，用 zod 写成判别联合
 * 会让**读**路径也跟着卡（后台详情、学生端列表都过同一个 schema），历史脏数据会把
 * 整页打不开。所以和 astRulesError 一样：只在写入前校验，读路径照样放行。
 *
 * 两层：先按 `exerciseDataByType` 查形状（键在不在、类型对不对），再走下面的语义
 * 检查（选项够不够、下标越不越界）。形状那层是后补的 —— 之前只有语义检查，
 * 而它**一次都没查过 `question`**，一道没有题干的练习能存进库。
 *
 * 为什么非校验不可：以前唯一的校验在前端 ExerciseManager 的 buildData()，而它对
 * fill 和 mcq 几乎不查 —— 一道没有 `{{空位}}` 的填空题能存进库，学生端渲染出来是
 * 一段没有输入框的代码，交不了也做不完，而老师那边显示「已发布」。坏数据只有学生撞得到。
 *
 * 返回 null 表示通过，否则是给老师看的中文原因。
 */
export function exerciseDataError(
  type: ExerciseType,
  data: Record<string, unknown>,
): string | null {
  const shape = exerciseDataByType[type]
  if (!shape) return `未知的题型 ${type}`
  const parsed = shape.safeParse(data)
  if (!parsed.success) {
    // 老师看到的是「题干必须是文字」这种话，不是 zod 的英文 issue
    const issue = parsed.error.issues[0]!
    // 只取第一段：数组项的 path 是 ["options", 0]，老师要看的是「选项」
    const field = String(issue.path[0] ?? "内容")
    return `${FIELD_LABELS[field] ?? field}的格式不对（${issue.message}）`
  }
  switch (type) {
    case "mcq": {
      const options = strings(data.options)
      if (options.length < 2) return "选择题至少要有 2 个选项"
      if (options.some((option) => !option.trim())) return "选择题的选项不能为空"
      return indexAnswerError(data.answer, options.length, "正确答案")
    }
    case "sort": {
      if (strings(data.lines).length < 2) return "排序题至少要有 2 行代码"
      return null
    }
    case "fill": {
      const code = typeof data.code === "string" ? data.code : ""
      if (!code.trim()) return "填空题的代码不能为空"
      // 学生端按 /\{\{([^}]+)\}\}/g 抠空位（ExerciseFill.vue），没有标记就没有空位
      if (!/\{\{[^}]+\}\}/.test(code)) {
        return "填空题的代码里没有空位，用 {{答案}} 标记，多个合法答案用 | 分隔"
      }
      return null
    }
    case "match": {
      const left = strings(data.left)
      const right = strings(data.right)
      if (left.length < 2 || right.length < 2) return "连线题左右两列各至少 2 项"
      if (left.length !== right.length) return "连线题左右两列的行数必须相等"
      return indexAnswerError(data.answer, right.length, "连线答案", left.length)
    }
    case "predict": {
      if (!(typeof data.code === "string" && data.code.trim())) return "输出预测题的代码不能为空"
      if (strings(data.answer).filter((item) => item.trim()).length === 0) {
        return "输出预测题至少要有一个正确输出"
      }
      return null
    }
    case "debug": {
      const lines = strings(data.lines)
      if (lines.length === 0) return "找错题的代码不能为空"
      return indexAnswerError(data.answer, lines.length, "错误行")
    }
    case "group": {
      const buckets = strings(data.buckets)
      const items = strings(data.items)
      if (buckets.length < 2) return "归类题至少要有 2 个分组"
      if (items.length === 0) return "归类题至少要有一个项目"
      // 归类题的下标**允许重复**：好几个项目落在同一个分组是常态，别顺手加去重
      return indexAnswerError(data.answer, buckets.length, "归类答案", items.length, false)
    }
  }
}

/** zod 报的是键名，老师看的得是人话 */
const FIELD_LABELS: Record<string, string> = {
  question: "题干",
  options: "选项",
  answer: "答案",
  lines: "代码行",
  code: "代码",
  left: "左列",
  right: "右列",
  buckets: "分组",
  items: "项目",
  explanation: "解析",
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : []
}

/**
 * 答案是一串下标：每个都得落在 `bound` 之内、不能重复。
 * `length` 给定时还要求答案条数正好等于它（连线、归类是一项一个答案，
 * 而选择题、找错题是「挑出若干个」，条数不固定）。`unique` 关掉时允许下标重复 ——
 * 归类题就是这样，好几个项目落进同一个分组。
 */
function indexAnswerError(
  value: unknown,
  bound: number,
  label: string,
  length?: number,
  unique = true,
): string | null {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item))) {
    return `${label}必须是一组下标`
  }
  const answer = value as number[]
  if (length === undefined ? answer.length === 0 : answer.length !== length) {
    return length === undefined
      ? `请至少勾选一个${label}`
      : `${label}的条数（${answer.length}）和项目数（${length}）对不上`
  }
  if (answer.some((item) => item < 0 || item >= bound)) return `${label}的下标越界`
  if (unique && new Set(answer).size !== answer.length) return `${label}里有重复的下标`
  return null
}
