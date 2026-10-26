import { randomBytes } from 'node:crypto'

import {
  AST_SUPPORTED_LANGUAGES,
  challengeSchema,
  type AstRule,
  type Challenge,
  type ChallengeInput,
  type ChallengeList,
  type ChallengeSuggestion,
  type ProblemChallenges,
  type ProblemLanguage,
} from '@oj2/contract'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { db, schema } from '../db'
import { astRulesError, checkAstGroups, type AstResult } from '../judge/ast'
import { JudgeStatus } from '../judge/status'

/**
 * 挑战：做对之后，同一道题加一条写法上的限制再做一遍。规则存在 problem.challenges，
 * 谁做到了记在 challenge_success。形状和口径见契约 challengeSchema。
 *
 * 这里管四件事：判（judge/run.ts 在做对的提交上调）、补（新加的挑战拿历史上做对的
 * 代码补一遍谁已经做到了）、给学生的列表、给出题页的候选。
 */

/** problem.challenges 里某种语言的挑战。逐条过 schema，一条坏的不连累别的（同 run.ts 的 astRulesForLanguage） */
export function challengesFor(value: unknown, language: string): Challenge[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const list = (value as Record<string, unknown>)[language]
  if (!Array.isArray(list)) return []
  return list.flatMap((item) => {
    const parsed = challengeSchema.safeParse(item)
    return parsed.success && parsed.data.rules.length > 0 ? [parsed.data] : []
  })
}

export interface ChallengeVerdict {
  id: string
  passed: boolean
  results: AstResult[]
}

/** 一份代码对着几条挑战各判一遍（只解析一次）。判不了就当一条都没做到 */
export async function judgeChallenges(code: string, language: string, challenges: Challenge[]): Promise<ChallengeVerdict[]> {
  if (challenges.length === 0) return []
  const groups = await checkAstGroups(
    code,
    language,
    challenges.map((challenge) => challenge.rules),
  )
  if (!groups) return []
  return challenges.map((challenge, i) => ({
    id: challenge.id,
    passed: groups[i]!.passed,
    results: groups[i]!.results,
  }))
}

interface SuccessRow {
  userId: number
  problemId: number
  challengeId: string
  submissionId: string
  createdAt: string
}

/** 记下做到了。已经做到过的不动 —— 留的是第一次做到的那份提交 */
export async function recordChallengeSuccesses(rows: SuccessRow[]) {
  if (rows.length === 0) return
  await db.insert(schema.challengeSuccess).values(rows).onConflictDoNothing()
}

// ---------------------------------------------------------------- 补历史记录

let scanning: Promise<void> | null = null

/**
 * 新加的挑战（没有 scannedAt 的）拿历史上做对的代码补一遍：一批人早就这么写过，
 * 不补的话「全站 N 人做到」从 0 开始，那些人打开挑战还得再交一次一模一样的代码。
 *
 * api 起来之后跑一次（迁移灌进来的那批在这里补），出题页保存之后再跑一次。
 * 两个站点共库、各起一个 api，可能同时补同一批 —— 插入是 on conflict do nothing，
 * 重复补只是白算一遍。
 *
 * 服务器只有 2 核：一道题几百份代码，每 50 份让出一次事件循环，别把请求卡住。
 */
export function scanPendingChallenges(): Promise<void> {
  if (!scanning) {
    scanning = scanAll()
      .catch((error: unknown) => console.error('[challenge] 补做到记录失败', error))
      .finally(() => {
        scanning = null
      })
  }
  return scanning
}

async function scanAll() {
  const problems = await db
    .select({ id: schema.problem.id, challenges: schema.problem.challenges })
    .from(schema.problem)
    .where(sql`${schema.problem.challenges} is not null`)
  for (const problem of problems) {
    for (const language of Object.keys(problem.challenges ?? {})) {
      const pending = challengesFor(problem.challenges, language).filter((c) => !c.scannedAt)
      if (pending.length === 0) continue
      const started = Date.now()
      const found = await scanProblem(problem.id, language, pending)
      await markScanned(
        problem.id,
        language,
        pending.map((c) => c.id),
      )
      console.log(`[challenge] 题 ${problem.id} ${language} 补了 ${pending.length} 条挑战、${found} 条做到，用时 ${Date.now() - started}ms`)
    }
  }
}

async function scanProblem(problemId: number, language: string, pending: Challenge[]) {
  const subs = await db
    .select({
      id: schema.submission.id,
      userId: schema.submission.userId,
      code: schema.submission.code,
      createTime: schema.submission.createTime,
    })
    .from(schema.submission)
    // 库里有一批孤儿提交（用户删了、提交还在），记不进 challenge_success 的外键
    .innerJoin(schema.user, eq(schema.user.id, schema.submission.userId))
    .where(
      and(
        eq(schema.submission.problemId, problemId),
        eq(schema.submission.result, JudgeStatus.ACCEPTED),
        eq(schema.submission.language, language as ProblemLanguage),
        isNull(schema.submission.contestId),
      ),
    )
    // 按时间顺着判：同一个人第一次做到的那份先遇到
    .orderBy(asc(schema.submission.createTime))

  const seen = pending.map(() => new Set<number>())
  let rows: SuccessRow[] = []
  let found = 0
  for (const [index, sub] of subs.entries()) {
    if (pending.every((_, i) => seen[i]!.has(sub.userId))) continue
    const verdicts = await judgeChallenges(sub.code, language, pending)
    for (const [i, verdict] of verdicts.entries()) {
      if (!verdict.passed || seen[i]!.has(sub.userId)) continue
      seen[i]!.add(sub.userId)
      rows.push({
        userId: sub.userId,
        problemId,
        challengeId: verdict.id,
        submissionId: sub.id,
        createdAt: sub.createTime,
      })
    }
    if (rows.length >= 500) {
      found += rows.length
      await recordChallengeSuccesses(rows)
      rows = []
    }
    if (index % 50 === 49) await Bun.sleep(0)
  }
  found += rows.length
  await recordChallengeSuccesses(rows)
  return found
}

/** 补完记一笔。重新读一遍再写：补的这会儿老师可能刚存过，只给还在、id 没变的那几条打标记 */
async function markScanned(problemId: number, language: string, ids: string[]) {
  const [row] = await db.select({ challenges: schema.problem.challenges }).from(schema.problem).where(eq(schema.problem.id, problemId)).limit(1)
  const current = row?.challenges
  if (!current?.[language]) return
  const now = new Date().toISOString()
  const next: ProblemChallenges = {
    ...current,
    [language]: current[language]!.map((c) => (ids.includes(c.id) ? { ...c, scannedAt: now } : c)),
  }
  await db.update(schema.problem).set({ challenges: next }).where(eq(schema.problem.id, problemId))
}

// ---------------------------------------------------------------- 出题页保存

function sameRules(a: AstRule[], b: AstRule[]) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 出题页提交的挑战 → 落库的形状。只留题目收的、判题机判得了的语言（同 pickAstRules）；
 * 规则没变的沿用原来的 id 和 scannedAt，改过的、新加的发新 id —— 做到记录跟着 id 走，
 * 规则一变旧记录就不作数了。
 */
export function normalizeChallenges(
  input: Record<string, ChallengeInput[]> | null,
  previous: ProblemChallenges | null,
  languages: string[],
): { error: string } | { challenges: ProblemChallenges | null } {
  if (!input) return { challenges: null }
  const out: ProblemChallenges = {}
  for (const [language, list] of Object.entries(input)) {
    if (!languages.includes(language) || !AST_SUPPORTED_LANGUAGES.includes(language)) continue
    const before = previous?.[language] ?? []
    const items: Challenge[] = []
    for (const [index, item] of list.entries()) {
      const error = astRulesError({ [language]: item.rules })
      if (error)
        return {
          error: `挑战 ${language} 第 ${index + 1} 条：${error.replace(/^代码规则 \S+ /, '')}`,
        }
      const kept = before.find((c) => c.id === item.id && sameRules(c.rules, item.rules))
      items.push({
        id: kept?.id ?? randomBytes(4).toString('hex'),
        wording: item.wording,
        rules: item.rules,
        ...(kept?.scannedAt ? { scannedAt: kept.scannedAt } : {}),
      })
    }
    if (items.length > 0) out[language] = items
  }
  return { challenges: Object.keys(out).length > 0 ? out : null }
}

// ---------------------------------------------------------------- 给学生的列表

/**
 * 几道题、某种语言下的挑战：说法、全站几人做到、我做到没有（做到了是本班、全站第几个）。
 * 规则原文不下发，同 astRequirements。题号按传进来的顺序返回，没配挑战的题不返回。
 */
export async function challengeList(user: { id: number; className: string | null }, displayIds: string[], language: string): Promise<ChallengeList> {
  if (displayIds.length === 0) return []
  const problems = await db
    .select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      title: schema.problem.title,
      challenges: schema.problem.challenges,
    })
    .from(schema.problem)
    .where(and(inArray(schema.problem.displayId, displayIds), isNull(schema.problem.contestId), sql`${schema.problem.challenges} is not null`))
  const configured = problems.map((p) => ({ ...p, list: challengesFor(p.challenges, language) })).filter((p) => p.list.length > 0)
  if (configured.length === 0) return []
  const ids = configured.map((p) => p.id)

  const acceptedBy = and(
    inArray(schema.submission.problemId, ids),
    eq(schema.submission.result, JudgeStatus.ACCEPTED),
    eq(schema.submission.language, language as ProblemLanguage),
    isNull(schema.submission.contestId),
  )
  const [acRows, solvedRows, doneRows, mineRows] = await Promise.all([
    db
      .select({
        problemId: schema.submission.problemId,
        count: sql<number>`count(distinct ${schema.submission.userId})::int`,
      })
      .from(schema.submission)
      .where(acceptedBy)
      .groupBy(schema.submission.problemId),
    db
      .selectDistinct({ problemId: schema.submission.problemId })
      .from(schema.submission)
      .where(and(acceptedBy, eq(schema.submission.userId, user.id))),
    db
      .select({
        problemId: schema.challengeSuccess.problemId,
        challengeId: schema.challengeSuccess.challengeId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.challengeSuccess)
      .where(inArray(schema.challengeSuccess.problemId, ids))
      .groupBy(schema.challengeSuccess.problemId, schema.challengeSuccess.challengeId),
    db
      .select()
      .from(schema.challengeSuccess)
      .where(and(inArray(schema.challengeSuccess.problemId, ids), eq(schema.challengeSuccess.userId, user.id))),
  ])

  // 第几个做到：比我早的有几个。同一时刻的按 id 排（补记录时同一批插入的 id 也是按时间顺的）
  const ranks = await Promise.all(
    mineRows.map(async (mine) => {
      const earlier = and(
        eq(schema.challengeSuccess.problemId, mine.problemId),
        eq(schema.challengeSuccess.challengeId, mine.challengeId),
        sql`(${schema.challengeSuccess.createdAt}, ${schema.challengeSuccess.id}) < (${mine.createdAt}, ${mine.id})`,
      )
      const [site] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.challengeSuccess)
        .where(earlier)
      const [cls] = user.className
        ? await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.challengeSuccess)
            .innerJoin(schema.user, eq(schema.user.id, schema.challengeSuccess.userId))
            .where(and(earlier, eq(schema.user.className, user.className)))
        : [null]
      return {
        key: `${mine.problemId}:${mine.challengeId}`,
        mine: {
          at: mine.createdAt,
          siteRank: (site?.count ?? 0) + 1,
          classRank: cls ? cls.count + 1 : null,
        },
      }
    }),
  )
  const mineByKey = new Map(ranks.map((r) => [r.key, r.mine]))
  const acByProblem = new Map(acRows.map((r) => [r.problemId, r.count]))
  const solved = new Set(solvedRows.map((r) => r.problemId))
  const doneByKey = new Map(doneRows.map((r) => [`${r.problemId}:${r.challengeId}`, r.count]))

  const byDisplayId = new Map(configured.map((p) => [p.displayId, p]))
  return displayIds.flatMap((displayId) => {
    const p = byDisplayId.get(displayId)
    if (!p) return []
    return [
      {
        problemId: p.displayId,
        title: p.title,
        acCount: acByProblem.get(p.id) ?? 0,
        solved: solved.has(p.id),
        challenges: p.list.map((c) => ({
          id: c.id,
          wording: c.wording,
          doneCount: doneByKey.get(`${p.id}:${c.id}`) ?? 0,
          mine: mineByKey.get(`${p.id}:${c.id}`) ?? null,
        })),
      },
    ]
  })
}

/** 课堂看板用：这些人在这些题上做到了哪些挑战（只认现在还配着的挑战） */
export async function challengeSuccessesOf(userIds: number[], problemIds: number[]) {
  if (userIds.length === 0 || problemIds.length === 0) return []
  return db
    .select({
      userId: schema.challengeSuccess.userId,
      problemId: schema.challengeSuccess.problemId,
      challengeId: schema.challengeSuccess.challengeId,
    })
    .from(schema.challengeSuccess)
    .where(and(inArray(schema.challengeSuccess.userId, userIds), inArray(schema.challengeSuccess.problemId, problemIds)))
}

// ---------------------------------------------------------------- 出题页的候选

interface Feature {
  rule: AstRule
  /** 用了它时的说法、没用它时的说法 */
  use: string
  avoid: string
}

/** 中文里夹的英文词两边留空格：「用 f-string 再写一遍」「用列表再写一遍」 */
function phrases(label: string) {
  const before = /^[A-Za-z.]/.test(label) ? ' ' : ''
  const after = /[A-Za-z)]$/.test(label) ? ' ' : ''
  return { use: `用${before}${label}${after}再写一遍`, avoid: `不用${before}${label}，再写一遍` }
}

const node = (target: string, label: string): Feature => ({
  rule: { engine: 'must_exist_node', target },
  ...phrases(label),
})
const call = (target: string): Feature => ({
  rule: { engine: 'must_call_function', target },
  ...phrases(`${target}()`),
})
const method = (target: string): Feature => ({
  rule: { engine: 'must_call_method', target },
  ...phrases(`.${target}()`),
})

/**
 * 去挖哪些写法。2026-10 第一批挑战是这样挖出来的，挖出来以后人工逐条看过，这几类基本
 * 都判掉了，所以这里干脆不挖：「不用 int()」（做到的是 eval）、「不用 elif / else」
 * （拆成一串 if、多写一个反向条件）、「用 str() / list() / strip()」（凑数）。
 */
const FEATURES: Record<string, Feature[]> = {
  Python: [
    node('for_loop', 'for 循环'),
    node('while_loop', 'while 循环'),
    node('if_statement', 'if'),
    node('function_definition', '自定义函数'),
    node('list_comprehension', '列表推导式'),
    node('list_literal', '列表'),
    node('dict_literal', '字典'),
    node('f_string', 'f-string'),
    ...['max', 'min', 'sum', 'len', 'sorted', 'abs', 'round', 'map', 'enumerate', 'zip'].map(call),
    ...['join', 'format', 'count', 'replace', 'split', 'upper', 'lower', 'find'].map(method),
  ],
  C: [
    node('for_loop', 'for 循环'),
    node('while_loop', 'while 循环'),
    node('do_while', 'do-while 循环'),
    node('if_statement', 'if'),
    node('switch_statement', 'switch'),
    node('function_definition', '自定义函数'),
    ...['puts', 'strlen', 'abs', 'pow', 'sqrt'].map(call),
  ],
}
FEATURES['C++'] = FEATURES.C!

const PRINT: Record<string, string> = { Python: 'print', C: 'printf', 'C++': 'printf' }

/** 「不用」能直接变成规则的引擎 */
const NEGATE: Record<string, AstRule['engine']> = {
  must_exist_node: 'must_not_exist_node',
  must_call_function: 'must_not_call_function',
  must_call_method: 'must_not_call_method',
}

/**
 * 出题页「挑战」的候选：这道题历史上做对的代码里，一批人用另一种写法也做对了的地方。
 * 门槛和第一批一样：多数人用了、有 ≥5 人没用也做对了 → 「不用 X」；少数人用了且 ≥5 人 →
 * 「用 X」；print 次数少于中位数且 ≥5 人做到 → 「少用 print」。
 */
export async function challengeSuggestions(
  problemId: number,
  language: string,
  existing: Challenge[],
): Promise<{ acCount: number; suggestions: ChallengeSuggestion[] }> {
  const features = FEATURES[language] ?? []
  const printName = PRINT[language] ?? 'print'
  const subs = await db
    .select({ userId: schema.submission.userId, code: schema.submission.code })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.problemId, problemId),
        eq(schema.submission.result, JudgeStatus.ACCEPTED),
        eq(schema.submission.language, language as ProblemLanguage),
        isNull(schema.submission.contestId),
      ),
    )
    .orderBy(asc(schema.submission.createTime))

  const groups = [...features.map((f) => [f.rule]), [{ engine: 'count_function_call', target: printName, min: 0 } satisfies AstRule]]
  interface Seen {
    code: string
    has: boolean[]
    prints: number
  }
  const byUser = new Map<number, Seen[]>()
  for (const [index, sub] of subs.entries()) {
    const list = byUser.get(sub.userId) ?? []
    // 一个人最多看 3 份：有人同一道题交了几十遍
    if (list.length >= 3) continue
    const verdicts = await checkAstGroups(sub.code, language, groups)
    if (!verdicts) continue
    list.push({
      code: sub.code,
      has: verdicts.slice(0, features.length).map((v) => v.passed),
      prints: verdicts.at(-1)?.results[0]?.actual ?? 0,
    })
    byUser.set(sub.userId, list)
    if (index % 50 === 49) await Bun.sleep(0)
  }
  const users = [...byUser.values()]
  const acCount = users.length
  if (acCount === 0) return { acCount, suggestions: [] }

  const example = (pick: (s: Seen) => boolean) => {
    const pool = users.flatMap((list) => list.filter(pick)).map((s) => s.code.trim())
    pool.sort((a, b) => a.length - b.length)
    return pool[Math.floor(pool.length / 2)] ?? ''
  }
  const suggestions: ChallengeSuggestion[] = []
  for (const [i, feature] of features.entries()) {
    const usedFirst = users.filter((list) => list[0]!.has[i]).length
    if (usedFirst / acCount >= 0.5) {
      const did = users.filter((list) => list.some((s) => !s.has[i])).length
      const engine = NEGATE[feature.rule.engine]
      if (did >= 5 && engine) {
        suggestions.push({
          wording: feature.avoid,
          rules: [{ ...feature.rule, engine }],
          did,
          firstShare: Math.round((usedFirst / acCount) * 100),
          example: example((s) => !s.has[i]),
        })
      }
    } else {
      const did = users.filter((list) => list.some((s) => s.has[i])).length
      if (did >= 5) {
        suggestions.push({
          wording: feature.use,
          rules: [feature.rule],
          did,
          firstShare: Math.round((usedFirst / acCount) * 100),
          example: example((s) => s.has[i] === true),
        })
      }
    }
  }

  const firstPrints = users.map((list) => list[0]!.prints).sort((a, b) => a - b)
  const median = firstPrints[Math.floor(firstPrints.length / 2)]!
  for (let level = 1; level < median; level++) {
    const ok = (s: Seen) => s.prints >= 1 && s.prints <= level
    const did = users.filter((list) => list.some(ok)).length
    if (did < 5) continue
    suggestions.push({
      wording: `只用 ${level} 次 ${printName}`,
      rules: [{ engine: 'count_function_call', target: printName, max: level }],
      did,
      firstShare: null,
      example: example(ok),
    })
    break
  }

  const taken = existing.map((c) => JSON.stringify(c.rules))
  return {
    acCount,
    suggestions: suggestions
      .filter((s) => !taken.includes(JSON.stringify(s.rules)))
      .sort((a, b) => b.did - a.did)
      .slice(0, 12),
  }
}
