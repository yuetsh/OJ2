/**
 * 成就指标注册表。对齐旧后端 `achievement/metrics.py` 的 METRIC_REGISTRY ——
 * 那边是装饰器注册，这里是一张表，作用一样：**后台下拉框里有什么，取决于代码里注册了什么**。
 *
 * 加一个新维度必须同时改这里和 `achievements.ts` 的计算逻辑并部署。
 * 只加这里而不算，会造出一个谁也拿不到的成就；只算而不加这里，后台就选不到它。
 */
export interface AchievementMetric {
  key: string
  name: string
  helpText: string
  /** 元指标：统计的是「已解锁成就数」自身，判定要在其它成就结算完之后再跑一轮 */
  meta?: boolean
}

export const ACHIEVEMENT_METRICS: AchievementMetric[] = [
  { key: "accepted_count", name: "AC 题目数", helpText: "去重后通过的题目数量（不含比赛）" },
  { key: "mid_ac_count", name: "中等题 AC 数", helpText: "去重后通过的中等难度题目数（不含比赛）" },
  { key: "hard_ac_count", name: "困难题 AC 数", helpText: "去重后通过的困难题目数（不含比赛）" },
  { key: "submission_count", name: "提交总数", helpText: "提交次数（不含比赛）" },
  { key: "active_days", name: "活跃天数", helpText: "有过提交的累计天数" },
  { key: "max_ac_streak_days", name: "最长连续 AC 天数", helpText: "连续每天至少 AC 一题的最长天数" },
  { key: "languages_used", name: "使用语言数", helpText: "用过多少种编程语言" },
  { key: "contest_joined", name: "参赛场次", helpText: "参加过的比赛数量（本指标是比赛维度，不受比赛提交不计入的限制）" },
  { key: "badge_count", name: "题单奖章数", helpText: "获得的题单奖章数量" },
  { key: "problemset_completed", name: "完成题单数", helpText: "完成的题单数量" },
  { key: "first_try_ac_count", name: "一发入魂次数", helpText: "首次提交即通过的次数" },
  { key: "midnight_submissions", name: "凌晨提交次数", helpText: "0:00–5:00 之间的提交次数" },
  { key: "early_bird_submissions", name: "早起提交次数", helpText: "5:00–7:00 之间的提交次数" },
  { key: "compile_error_count", name: "编译错误次数", helpText: "累计编译错误的次数" },
  { key: "max_wa_before_ac", name: "屡败屡战", helpText: "单题失败最多多少次后终于通过" },
  { key: "max_ac_in_one_day", name: "单日最多 AC", helpText: "一天之内最多通过多少题" },
  { key: "max_code_lines", name: "最长代码行数", helpText: "提交过的最长代码有多少行" },
  { key: "achievement_unlocked_count", name: "已解锁成就数", helpText: "已解锁的成就数量（不含白金档）", meta: true },
]

const BY_KEY = new Map(ACHIEVEMENT_METRICS.map((item) => [item.key, item]))

export function findMetric(key: string) {
  return BY_KEY.get(key) ?? null
}

export function metricName(key: string) {
  return BY_KEY.get(key)?.name ?? key
}

/** 稀有度四档。乱填的值会让成就汇总接口的分档统计对不上：野值算进总数却不出现在任何一档 */
export const RARITIES = ["bronze", "silver", "gold", "platinum"] as const
export const OPERATORS = ["gte", "lte"] as const
