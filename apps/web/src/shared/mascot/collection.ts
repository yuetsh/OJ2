import { MASCOT_LINES, type MascotSituation } from './lines'

/**
 * 台词收集：她对这个学生说过哪些话，和台词表（lines.ts）对一遍，按组数听过几句、还差几句。
 *
 * 只收学生听得到的：老师那边的（teacher.*）、没登录时说的（guest）不算。几组里一模一样的句子
 * （「好饿」）只算一句。闲聊问的问题、翻旧账的回答在 chat.ts，不在表里，也不算。
 *
 * 库里记的是填好数的那一句（「还差 3 道」），所以带占位的台词按通配对。
 */

interface Group {
  name: string
  test: (situation: string) => boolean
}

const prefix =
  (...list: string[]) =>
  (situation: string) =>
    list.some((it) => situation === it || situation.startsWith(it + '.'))

/** 按顺序认，先认到的那组算 */
const GROUPS: Group[] = [
  { name: '打招呼', test: prefix('greet', 'first', 'familiar', 'wake', 'home.back', 'notFound', 'offHours', 'time', 'day') },
  { name: '闲聊', test: prefix('chat') },
  { name: '做题的时候', test: prefix('problem', 'class', 'habit', 'idle', 'gentle', 'flowchart', 'submission', 'lint') },
  {
    name: '逛别的页面',
    test: prefix(
      'home',
      'problems',
      'problemsets',
      'problemset',
      'learn',
      'tutorial',
      'rank',
      'pk',
      'contests',
      'announcement',
      'profile',
      'achievement',
      'today',
      'submissions',
    ),
  },
  { name: '被惹烦了', test: prefix('pester', 'sulk', 'overclick') },
  { name: '被摆弄', test: prefix('patting', 'play', 'peek') },
  { name: '小鱼干', test: prefix('feed', 'dress', 'daily') },
  { name: '熟了以后', test: prefix('affinity', 'memory') },
  { name: '稀有', test: prefix('rare') },
]

const HIDDEN = prefix('teacher', 'guest')

export interface CollectionLine {
  /** 台词原文，占位换成「…」；没听过的是一串问号，和原句差不多长 */
  text: string
  heard: boolean
}

export interface CollectionGroup {
  name: string
  heard: number
  lines: CollectionLine[]
}

interface Entry {
  template: string
  match: (line: string) => boolean
}

function entryOf(template: string): Entry {
  if (!template.includes('{')) return { template, match: (line) => line === template }
  const escaped = template.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&').replace(/\\\{\w+\\\}/g, '.+')
  const re = new RegExp(`^${escaped}$`)
  return { template, match: (line) => re.test(line) }
}

/** 按组排好的整张表，只建一次 */
const TABLE: { name: string; entries: Entry[] }[] = (() => {
  const seen = new Set<string>()
  const groups = GROUPS.map((group) => ({ name: group.name, entries: [] as Entry[] }))
  for (const situation of Object.keys(MASCOT_LINES) as MascotSituation[]) {
    if (HIDDEN(situation)) continue
    const index = GROUPS.findIndex((group) => group.test(situation))
    if (index < 0) continue
    for (const template of MASCOT_LINES[situation]) {
      if (seen.has(template)) continue
      seen.add(template)
      groups[index]!.entries.push(entryOf(template))
    }
  }
  return groups.filter((group) => group.entries.length)
})()

export function buildCollection(heardLines: readonly string[]) {
  const exact = new Set(heardLines)
  const groups: CollectionGroup[] = TABLE.map(({ name, entries }) => {
    const lines = entries.map(({ template, match }) => ({
      text: template.replace(/\{\w+\}/g, '…'),
      heard: exact.has(template) || (template.includes('{') && heardLines.some(match)),
    }))
    for (const line of lines) if (!line.heard) line.text = '？'.repeat(Math.min(10, Math.max(2, Math.round(line.text.length / 2))))
    // 听过的排前面；没听过的照台词长短给几个问号，看得出长短、看不出内容
    lines.sort((a, b) => Number(b.heard) - Number(a.heard))
    return { name, heard: lines.filter((it) => it.heard).length, lines }
  })
  return {
    groups,
    heard: groups.reduce((sum, it) => sum + it.heard, 0),
    total: groups.reduce((sum, it) => sum + it.lines.length, 0),
  }
}
