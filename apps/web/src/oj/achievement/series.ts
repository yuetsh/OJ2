import type { Achievement } from "utils/types"

/**
 * 成就页按「一条条线」摆：同一个指标的几档是一条线（做对 1 / 10 / 50 / 100 / 200 道），
 * 几条线归一组。设计稿「我的成就重设计」定稿（画布 page ach）。
 *
 * 指标是后台可配的，这里没登记的指标归到「其他」、拿第一档的名字当线名 —— 不会丢，只是不好看，
 * 在后台加了新指标记得回来补一行。
 */
export const GROUPS = ["做题", "坚持", "题单和比赛", "其他", "彩蛋"] as const
export type GroupName = (typeof GROUPS)[number]

interface MetricInfo {
  group: GroupName
  label: string
  unit: string
  /** 还差 r 的时候怎么说 */
  remain: (r: number) => string
  /** 进度是「现在连着几」，标签前面带「现在」 */
  streak?: boolean
}

const METRICS: Record<string, MetricInfo> = {
  accepted_count: { group: "做题", label: "做对的题", unit: "道", remain: (r) => `再做对 ${r} 道` },
  mid_ac_count: {
    group: "做题",
    label: "中等题",
    unit: "道",
    remain: (r) => `再做对 ${r} 道中等题`,
  },
  hard_ac_count: {
    group: "做题",
    label: "困难题",
    unit: "道",
    remain: (r) => `再做对 ${r} 道困难题`,
  },
  max_ac_week_streak: {
    group: "坚持",
    label: "连着几周有做对",
    unit: "周",
    remain: (r) => `再连着 ${r} 周都有做对`,
    streak: true,
  },
  max_ac_streak_days: {
    group: "坚持",
    label: "连着几天有做对",
    unit: "天",
    remain: (r) => `再连着 ${r} 天都有做对`,
  },
  active_days: {
    group: "坚持",
    label: "交过题的日子",
    unit: "天",
    remain: (r) => `再有 ${r} 天交题`,
  },
  submission_count: { group: "坚持", label: "交了几次", unit: "次", remain: (r) => `再交 ${r} 次` },
  problemset_completed: {
    group: "题单和比赛",
    label: "做完的题单",
    unit: "个",
    remain: (r) => `再做完 ${r} 个题单`,
  },
  badge_count: {
    group: "题单和比赛",
    label: "题单奖章",
    unit: "枚",
    remain: (r) => `再拿 ${r} 枚题单奖章`,
  },
  contest_joined: {
    group: "题单和比赛",
    label: "参加的比赛",
    unit: "场",
    remain: (r) => `再参加 ${r} 场比赛`,
  },
  languages_used: {
    group: "其他",
    label: "用过的语言",
    unit: "种",
    remain: (r) => `再用 ${r} 种语言`,
  },
  achievement_unlocked_count: {
    group: "其他",
    label: "拿到的成就",
    unit: "个",
    remain: (r) => `再拿 ${r} 个成就`,
  },
  first_try_ac_count: {
    group: "彩蛋",
    label: "一交就对",
    unit: "道",
    remain: (r) => `再有 ${r} 道一交就对`,
  },
  max_ac_in_one_day: {
    group: "彩蛋",
    label: "一天做对",
    unit: "道",
    remain: (r) => `一天做对 ${r} 道`,
  },
  midnight_submissions: {
    group: "彩蛋",
    label: "凌晨交题",
    unit: "次",
    remain: (r) => `再交 ${r} 次`,
  },
  early_bird_submissions: {
    group: "彩蛋",
    label: "早上交题",
    unit: "次",
    remain: (r) => `再交 ${r} 次`,
  },
  compile_error_count: {
    group: "彩蛋",
    label: "编译失败",
    unit: "次",
    remain: (r) => `还差 ${r} 次`,
  },
  max_wa_before_ac: {
    group: "彩蛋",
    label: "错了好多次才做对",
    unit: "次",
    remain: (r) => `还差 ${r} 次`,
  },
  max_code_lines: {
    group: "彩蛋",
    label: "做对的代码最长",
    unit: "行",
    remain: (r) => `还差 ${r} 行`,
  },
}

const METRIC_ORDER = Object.keys(METRICS)

export interface Series {
  metric: string
  group: GroupName
  label: string
  unit: string
  streak: boolean
  /** 现在的数 */
  value: number
  /** 按门槛从低到高 */
  items: Achievement[]
  /** 下一档（还没拿到的门槛最低的一个），全拿到了是 null */
  next: Achievement | null
}

export interface Group {
  name: GroupName
  series: Series[]
  /** 还没找到的隐藏成就（后端已经遮成问号，连属于哪条线都不知道） */
  masked: number
  got: number
  total: number
}

export function infoOf(metric: string): MetricInfo | null {
  return METRICS[metric] ?? null
}

export function buildGroups(achievements: Achievement[]): Group[] {
  const byMetric = new Map<string, Achievement[]>()
  let masked = 0
  let maskedGot = 0
  for (const item of achievements) {
    if (!item.metric) {
      masked += 1
      if (item.unlocked) maskedGot += 1
      continue
    }
    const list = byMetric.get(item.metric) ?? []
    list.push(item)
    byMetric.set(item.metric, list)
  }
  const series: Series[] = [...byMetric.entries()]
    .sort(([a], [b]) => rankOf(a) - rankOf(b))
    .map(([metric, items]) => {
      items.sort((a, b) => (a.threshold ?? 0) - (b.threshold ?? 0))
      const info = METRICS[metric]
      return {
        metric,
        group: info?.group ?? "其他",
        label: info?.label ?? items[0]!.name,
        unit: info?.unit ?? "",
        streak: info?.streak ?? false,
        value: items[0]!.progress ?? 0,
        items,
        next: items.find((item) => !item.unlocked) ?? null,
      }
    })
  return GROUPS.map((name) => {
    const own = series.filter((item) => item.group === name)
    const extra = name === "彩蛋" ? masked : 0
    const items = own.flatMap((item) => item.items)
    return {
      name,
      series: own,
      masked: extra,
      got: items.filter((item) => item.unlocked).length + (name === "彩蛋" ? maskedGot : 0),
      total: items.length + extra,
    }
  })
}

function rankOf(metric: string) {
  const index = METRIC_ORDER.indexOf(metric)
  return index < 0 ? METRIC_ORDER.length : index
}

export interface Near {
  achievement: Achievement
  series: Series
  remain: string
}

/**
 * 「快拿到了」：每条线只看下一档，按完成了几成排，取前三。
 * 一个都没做的新同学全是 0，就按指标先后排 —— 第一个是「做对 1 道」。
 */
export function nearest(groups: Group[], limit = 3): Near[] {
  const candidates: Near[] = []
  for (const group of groups) {
    for (const series of group.series) {
      const next = series.next
      if (!next || next.operator !== "gte" || !next.threshold) continue
      const r = next.threshold - series.value
      if (r <= 0) continue
      const info = METRICS[series.metric]
      candidates.push({
        achievement: next,
        series,
        remain: info ? info.remain(r) : `还差 ${r}`,
      })
    }
  }
  const ratio = (item: Near) => item.series.value / item.achievement.threshold!
  return candidates
    .sort((a, b) => ratio(b) - ratio(a) || rankOf(a.series.metric) - rankOf(b.series.metric))
    .slice(0, limit)
}
