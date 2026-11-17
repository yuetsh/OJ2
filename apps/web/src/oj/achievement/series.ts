import type { Achievement } from 'utils/types'

/**
 * 成就页按「一条条线」摆：同一个指标的几档是一条线（做对 1 / 10 / 50 / 100 / 200 道），
 * 几条线归一组。设计稿「我的成就重设计」定稿（画布 page ach）。
 *
 * 指标是后台可配的，这里没登记的指标归到「其他」、拿第一档的名字当线名 —— 不会丢，只是不好看，
 * 在后台加了新指标记得回来补一行。
 */
export const GROUPS = ['做题', '坚持', '专题和比赛', '其他', '彩蛋', '小鲸鱼'] as const
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
  accepted_count: { group: '做题', label: '做对的题', unit: '道', remain: (r) => `再做对 ${r} 道` },
  mid_ac_count: {
    group: '做题',
    label: '中等题',
    unit: '道',
    remain: (r) => `再做对 ${r} 道中等题`,
  },
  hard_ac_count: {
    group: '做题',
    label: '困难题',
    unit: '道',
    remain: (r) => `再做对 ${r} 道困难题`,
  },
  challenge_count: {
    group: '做题',
    label: '挑战成功',
    unit: '次',
    remain: (r) => `再挑战成功 ${r} 次`,
  },
  max_ac_week_streak: {
    group: '坚持',
    label: '连着几周有做对',
    unit: '周',
    remain: (r) => `再连着 ${r} 周都有做对`,
    streak: true,
  },
  max_ac_streak_days: {
    group: '坚持',
    label: '连着几天有做对',
    unit: '天',
    remain: (r) => `再连着 ${r} 天都有做对`,
  },
  active_days: {
    group: '坚持',
    label: '交过题的日子',
    unit: '天',
    remain: (r) => `再有 ${r} 天交题`,
  },
  submission_count: { group: '坚持', label: '交了几次', unit: '次', remain: (r) => `再交 ${r} 次` },
  problemset_completed: {
    group: '专题和比赛',
    label: '做完的专题',
    unit: '个',
    remain: (r) => `再做完 ${r} 个专题`,
  },
  badge_count: {
    group: '专题和比赛',
    label: '专题奖章',
    unit: '枚',
    remain: (r) => `再拿 ${r} 枚专题奖章`,
  },
  contest_joined: {
    group: '专题和比赛',
    label: '参加的比赛',
    unit: '场',
    remain: (r) => `再参加 ${r} 场比赛`,
  },
  languages_used: {
    group: '其他',
    label: '用过的语言',
    unit: '种',
    remain: (r) => `再用 ${r} 种语言`,
  },
  achievement_unlocked_count: {
    group: '其他',
    label: '拿到的成就',
    unit: '个',
    remain: (r) => `再拿 ${r} 个成就`,
  },
  first_try_ac_count: {
    group: '彩蛋',
    label: '一交就对',
    unit: '道',
    remain: (r) => `再有 ${r} 道一交就对`,
  },
  max_ac_in_one_day: {
    group: '彩蛋',
    label: '一天做对',
    unit: '道',
    remain: (r) => `一天做对 ${r} 道`,
  },
  midnight_submissions: {
    group: '彩蛋',
    label: '凌晨交题',
    unit: '次',
    remain: (r) => `再交 ${r} 次`,
  },
  early_bird_submissions: {
    group: '彩蛋',
    label: '早上交题',
    unit: '次',
    remain: (r) => `再交 ${r} 次`,
  },
  compile_error_count: {
    group: '彩蛋',
    label: '编译失败',
    unit: '次',
    remain: (r) => `还差 ${r} 次`,
  },
  max_wa_before_ac: {
    group: '彩蛋',
    label: '错了好多次才做对',
    unit: '次',
    remain: (r) => `还差 ${r} 次`,
  },
  max_code_lines: {
    group: '彩蛋',
    label: '做对的代码最长',
    unit: '行',
    remain: (r) => `还差 ${r} 行`,
  },
  // 「小鲸鱼」：看板娘的互动做的（0047）。只有一档的隐藏成就不排成线，摆成一格格的（Group.found）
  mascot_days: { group: '小鲸鱼', label: '来找她的天数', unit: '天', remain: (r) => `再有 ${r} 天来找她` },
  mascot_fed: { group: '小鲸鱼', label: '喂的小鱼干', unit: '条', remain: (r) => `再喂她 ${r} 条小鱼干` },
  mascot_daily: { group: '小鲸鱼', label: '做对每天一道', unit: '次', remain: (r) => `再做对 ${r} 次每天一道` },
  mascot_poses: { group: '小鲸鱼', label: '见过的样子', unit: '种', remain: (r) => `再见到她 ${r} 种样子` },
  mascot_lines: { group: '小鲸鱼', label: '听过的话', unit: '句', remain: (r) => `再听她说 ${r} 句` },
  mascot_outfits: { group: '小鲸鱼', label: '换过的衣服', unit: '身', remain: (r) => `再给她换 ${r} 身` },
  mascot_answers: { group: '小鲸鱼', label: '答过的问题', unit: '道', remain: (r) => `再答她 ${r} 道问题` },
  mascot_mistakes: { group: '小鲸鱼', label: '被她指出的错', unit: '种', remain: (r) => `还差 ${r} 种` },
  mascot_fling: { group: '小鲸鱼', label: '甩晕她', unit: '次', remain: (r) => `再甩 ${r} 次` },
}

/** 「小鲸鱼」那一组的指标（键的前缀，和后端 MASCOT_METRIC_PREFIX 一致） */
export function isMascotMetric(metric: string | null | undefined) {
  return !!metric?.startsWith('mascot_')
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
  /** 「小鲸鱼」组里只有一档的隐藏成就（玩她玩出来的），拿到的摆成一格格，不排成线 */
  found: Achievement[]
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
  // 还没找到的隐藏成就按组数：「小鲸鱼」的问号放在它自己那一组，别的都在「彩蛋」
  const masked = { 彩蛋: 0, 小鲸鱼: 0 }
  for (const item of achievements) {
    if (!item.metric) {
      masked[item.mascot ? '小鲸鱼' : '彩蛋'] += 1
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
        // 「小鲸鱼」那几个一档的隐藏成就没登记，按前缀认
        group: info?.group ?? (isMascotMetric(metric) ? '小鲸鱼' : '其他'),
        label: info?.label ?? items[0]!.name,
        unit: info?.unit ?? '',
        streak: info?.streak ?? false,
        value: items[0]!.progress ?? 0,
        items,
        next: items.find((item) => !item.unlocked) ?? null,
      }
    })
  return GROUPS.map((name) => {
    const own = series.filter((item) => item.group === name)
    const single = (item: Series) => name === '小鲸鱼' && item.items.length === 1 && item.items[0]!.hidden
    const extra = name === '彩蛋' || name === '小鲸鱼' ? masked[name] : 0
    const items = own.flatMap((item) => item.items)
    return {
      name,
      series: own.filter((item) => !single(item)),
      found: own.filter(single).map((item) => item.items[0]!),
      masked: extra,
      // 问号都是还没拿到的（拿到了就亮出来了）
      got: items.filter((item) => item.unlocked).length,
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
    // 「快拿到了」只提做题这边的，玩她的不提
    if (group.name === '小鲸鱼') continue
    for (const series of group.series) {
      const next = series.next
      if (!next || next.operator !== 'gte' || !next.threshold) continue
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
  return candidates.sort((a, b) => ratio(b) - ratio(a) || rankOf(a.series.metric) - rankOf(b.series.metric)).slice(0, limit)
}
