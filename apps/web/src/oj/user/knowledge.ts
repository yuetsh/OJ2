import type { KnowledgeLevel, KnowledgeMap } from "utils/types"

/**
 * 知识点地图的档位名（后端 routes/account.ts 的 levelThresholds 定门槛）。
 * 用「会了」「熟练」这种学生听得懂的词，不用「Lv.3」—— 这张图要说的是「我会了什么」，
 * 不是又一套积分。
 */
export const LEVEL_NAMES = ["没碰过", "入门", "会了", "熟练", "精通"] as const

export const MAX_LEVEL = LEVEL_NAMES.length - 1

export function levelName(level: number) {
  return LEVEL_NAMES[Math.max(0, Math.min(MAX_LEVEL, level))]!
}

/** 离下一档还差几道；已经最高档为 null */
export function remainingToNext(tag: KnowledgeLevel) {
  return tag.nextAt === null ? null : Math.max(1, tag.nextAt - tag.solved)
}

export function tagLink(name: string) {
  return { path: "/problem", query: { tag: name } }
}

export interface Headline {
  text: string
  /** 点了去哪：按这个知识点筛的题目列表 */
  to?: ReturnType<typeof tagLink>
}

/**
 * 首页「你好」下面那一行：一次只说一件事，挑最能让人想再做一道的那件。
 *
 * 1. 本周升级了 —— 刚发生的进步，最值得说
 * 2. 正在学的里面，离下一档最近的那个（班里在学的优先）—— 给一个很近的目标
 * 3. 一个都没点亮：挑一个班里同学在学的，让他去点亮
 */
export function pickHeadline(map: KnowledgeMap): Headline | null {
  const upgraded = map.tags
    .filter((tag) => tag.level > tag.levelAtWeekStart)
    .sort((a, b) => b.level - a.level)
  if (upgraded.length === 1) {
    const tag = upgraded[0]!
    return { text: `本周升级：${tag.name} → ${levelName(tag.level)}`, to: tagLink(tag.name) }
  }
  if (upgraded.length > 1) {
    const list = upgraded.map((tag) => `${tag.name}「${levelName(tag.level)}」`).join("、")
    return { text: `本周升级了 ${upgraded.length} 个知识点：${list}` }
  }

  const touched = new Set(map.classTouched)
  const learning = map.tags
    .filter((tag) => tag.level >= 1 && tag.level < MAX_LEVEL)
    .sort(
      (a, b) =>
        Number(touched.has(b.name)) - Number(touched.has(a.name)) ||
        remainingToNext(a)! - remainingToNext(b)!,
    )
  const next = learning[0]
  if (next) {
    return {
      text: `正在学${next.name}，再做 ${remainingToNext(next)} 道就到「${levelName(next.level + 1)}」`,
      to: tagLink(next.name),
    }
  }

  const fresh = map.tags.find((tag) => tag.level === 0 && touched.has(tag.name))
  if (fresh) {
    return { text: `班里同学在学${fresh.name}，去做一道点亮它`, to: tagLink(fresh.name) }
  }
  return null
}
