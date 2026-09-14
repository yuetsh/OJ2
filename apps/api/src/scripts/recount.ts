import { eq, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { JudgeStatus, isAccepted } from "../judge/status"
import { objectValue } from "../routes/helpers"
import { metaAchievements, refreshUnlockedCount, rescanAchievement } from "../services/achievements"

/**
 * 把反范式的计数列重算回与 submission 表一致。
 *
 * 这几个列不是缓存、是真值的副本：判题落库时由 `judge/run.ts` 的 persistResult 手工
 * 加减，谁都没在事后核对过。已知的漂移来源是**重判**——`routes/submission.ts` 的
 * rejudge 把 result 打回 PENDING 就重新入队，**不回退任何计数**，于是 persistResult
 * 再加一次：重判一条题目的 submission_number 就永久多一。删提交、直接改库同理。
 *
 * 管的六个列：
 *   problem.submission_number / accepted_number / statistic_info
 *   user_profile.submission_number / accepted_number / acm_problems_status
 *
 * 外加 `user_stat.metrics.achievement_unlocked_count`（已解锁的非白金成就数，是
 * user_achievement 的副本）以及它连带的「奖杯收藏家」：计数改对之后，达标却没发的
 * 走 `rescanAchievement` 补发（backfilled、推通知）。已知漂移来源是后台补发成就 ——
 * 2026-09-07 一次补发后 269 人少算、10 人漏发，`rescanAchievement` 已修，这里订存量。
 *
 * **不管**的：acm_contest_rank（比赛榜有自己的一套罚时累计，重算要连带 submission_info
 * 里每题的尝试次数，口径复杂，单独一件事）、achievement.unlock_count（0010 之后
 * user_achievement 随成就级联，漂不了）、题单进度与奖章（走 backfill-problemsets）。
 *
 * 默认只读，把差异打出来；确认无误再加 --apply 落库。跑法对齐 migrate：
 *
 *   docker compose -f docker/compose.debian.yml run --rm oj-api oj2-api recount
 *   docker compose -f docker/compose.debian.yml run --rm oj-api oj2-api recount --apply
 *
 * ⚠️ **--apply 要挑没人做题的时候跑。** 差异是在事务外算的，写的是绝对值：算完到写完
 * 之间要是有一条判完了，它那一笔加法会被覆盖掉。落库后的复核会把这种情况报成「仍有
 * N 处差异」并以 1 退出，不会静默 —— 见到了重跑一次即可，但别在上课高峰按。
 */

/** 判完的提交才计数。PENDING / JUDGING 是在途状态，persistResult 还没给它们记过账 */
const UNJUDGED = [JudgeStatus.PENDING, JudgeStatus.JUDGING]

type ProblemExpected = {
  submissionNumber: number
  acceptedNumber: number
  statisticInfo: Record<string, number>
}

/**
 * 题目侧的期望值。**比赛提交也算**——persistResult 更新 problem 这一段没有区分
 * contestId，只有 user_profile 那一段才分。
 */
async function expectedProblems() {
  const rows = await db.execute<{ problem_id: number; result: number; n: number }>(sql`
    select problem_id, result, count(*)::int as n
    from submission
    where result not in (${UNJUDGED[0]}, ${UNJUDGED[1]})
    group by problem_id, result
  `)
  const expected = new Map<number, ProblemExpected>()
  for (const row of rows) {
    const current = expected.get(row.problem_id) ?? {
      submissionNumber: 0,
      acceptedNumber: 0,
      statisticInfo: {},
    }
    current.submissionNumber += row.n
    if (isAccepted(row.result)) current.acceptedNumber += row.n
    current.statisticInfo[String(row.result)] = row.n
    expected.set(row.problem_id, current)
  }
  return expected
}

type ProfileExpected = {
  submissionNumber: number
  acceptedNumber: number
  status: Record<string, Record<string, { status: number; _id: string }>>
}

/**
 * 用户侧的期望值。三条口径都照抄 persistResult：
 *
 * - submission_number：只数**非比赛**的判完提交。
 * - accepted_number：只数非比赛、**去重到题**的首次通过（`acceptedNow && !wasAccepted`
 *   等价于「这道题此前没通过过」，累计下来就是 AC 的不同题目数）。
 * - acm_problems_status：`{ problems / contest_problems: { 题号: { status, _id } } }`。
 *   通过过就恒为 ACCEPTED（persistResult 里 `wasAccepted` 之后不再改写）；
 *   从没通过过则取**最后一次**判完的结果。
 *
 * ⚠️ 「最后一次」这里按 create_time 排，而 persistResult 是按**判完的先后**写的。
 * 两者在重判乱序时可能不同 —— 一条早提交的被重判、比晚提交的更晚判完，真值是那条早的，
 * 本工具会算成那条晚的。这种情况只影响「从没 AC 过的题」显示成哪种失败，不影响任何计数，
 * 所以按 create_time 算，不额外记判完时间。
 */
async function expectedProfiles() {
  const totals = await db.execute<{ user_id: number; submissions: number; accepted: number }>(sql`
    select user_id,
           count(*)::int as submissions,
           count(distinct problem_id) filter (where result in (${JudgeStatus.ACCEPTED}, ${JudgeStatus.AST_CHECK_FAILED}))::int as accepted
    from submission
    where result not in (${UNJUDGED[0]}, ${UNJUDGED[1]}) and contest_id is null
    group by user_id
  `)
  const perProblem = await db.execute<{
    user_id: number
    is_public: boolean
    problem_id: number
    display_id: string
    ever_accepted: boolean
    last_result: number
  }>(sql`
    select s.user_id,
           (s.contest_id is null) as is_public,
           s.problem_id,
           p._id as display_id,
           bool_or(s.result in (${JudgeStatus.ACCEPTED}, ${JudgeStatus.AST_CHECK_FAILED})) as ever_accepted,
           (array_agg(s.result order by s.create_time desc, s.id desc))[1] as last_result
    from submission s
    join problem p on p.id = s.problem_id
    where s.result not in (${UNJUDGED[0]}, ${UNJUDGED[1]})
    group by s.user_id, (s.contest_id is null), s.problem_id, p._id
  `)

  const expected = new Map<number, ProfileExpected>()
  const blank = (): ProfileExpected => ({ submissionNumber: 0, acceptedNumber: 0, status: {} })
  for (const row of totals) {
    const current = expected.get(row.user_id) ?? blank()
    current.submissionNumber = row.submissions
    current.acceptedNumber = row.accepted
    expected.set(row.user_id, current)
  }
  for (const row of perProblem) {
    const current = expected.get(row.user_id) ?? blank()
    const bucket = row.is_public ? "problems" : "contest_problems"
    current.status[bucket] ??= {}
    current.status[bucket]![String(row.problem_id)] = {
      status: row.ever_accepted ? JudgeStatus.ACCEPTED : row.last_result,
      _id: row.display_id,
    }
    expected.set(row.user_id, current)
  }
  return expected
}

/** 稳定序列化，用来比对 jsonb —— 键序不同不该被当成差异 */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

type Diff = { label: string; field: string; before: unknown; after: unknown }
type Plan = {
  diffs: Diff[]
  problemFixes: { id: number; value: ProblemExpected }[]
  profileFixes: { id: number; value: ProfileExpected & { merged: Record<string, unknown> } }[]
  /** achievement_unlocked_count 不对的用户 */
  unlockedCountFixes: number[]
  /** 按正确计数已达标、却没持有元成就的 (用户, 元成就) */
  metaGrants: { userId: number; achievementId: number }[]
}

/**
 * 已解锁数与元成就的差异。口径和 `refreshUnlockedCount` / 判题结算一致；
 * 元成就只看有 user_stat 的用户 —— `rescanAchievement` 也只扫这些人。
 */
async function unlockedCountPlan(plan: Plan) {
  const [rows, metas] = await Promise.all([
    db.execute<{ user_id: number; counter: unknown; actual: number }>(sql`
      select s.user_id, s.metrics -> 'achievement_unlocked_count' as counter, coalesce(c.value, 0) as actual
      from user_stat s
      left join (
        select ua.user_id, count(*)::int as value
        from user_achievement ua
        join achievement a on a.id = ua.achievement_id
        where a.rarity <> 'platinum'
        group by ua.user_id
      ) c on c.user_id = s.user_id
    `),
    metaAchievements(),
  ])
  const holders = metas.length
    ? await db.select({ userId: schema.userAchievement.userId, achievementId: schema.userAchievement.achievementId })
      .from(schema.userAchievement)
      .where(sql`${schema.userAchievement.achievementId} in ${metas.map((meta) => meta.id)}`)
    : []
  const held = new Set(holders.map((row) => `${row.userId}:${row.achievementId}`))

  for (const row of rows) {
    const label = `用户 ${row.user_id}`
    if (row.counter !== row.actual) {
      plan.diffs.push({ label, field: "achievement_unlocked_count", before: row.counter ?? null, after: row.actual })
      plan.unlockedCountFixes.push(row.user_id)
    }
    for (const meta of metas) {
      const met = meta.operator === "gte" ? row.actual >= meta.threshold : row.actual <= meta.threshold
      if (!met || held.has(`${row.user_id}:${meta.id}`)) continue
      plan.diffs.push({ label, field: `成就「${meta.name}」`, before: "未发", after: "补发" })
      plan.metaGrants.push({ userId: row.user_id, achievementId: meta.id })
    }
  }
}

/** 只算差异，不写库。预演和落库后的复核共用它 —— 两边口径必须是同一份代码 */
async function computePlan(): Promise<Plan> {
  const [problems, profiles, expectedProblem, expectedProfile] = await Promise.all([
    db.select({
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      submissionNumber: schema.problem.submissionNumber,
      acceptedNumber: schema.problem.acceptedNumber,
      statisticInfo: schema.problem.statisticInfo,
    }).from(schema.problem),
    db.select({
      id: schema.userProfile.id,
      userId: schema.userProfile.userId,
      submissionNumber: schema.userProfile.submissionNumber,
      acceptedNumber: schema.userProfile.acceptedNumber,
      acmProblemsStatus: schema.userProfile.acmProblemsStatus,
    }).from(schema.userProfile),
    expectedProblems(),
    expectedProfiles(),
  ])

  const plan: Plan = { diffs: [], problemFixes: [], profileFixes: [], unlockedCountFixes: [], metaGrants: [] }

  for (const problem of problems) {
    const want = expectedProblem.get(problem.id) ?? {
      submissionNumber: 0,
      acceptedNumber: 0,
      statisticInfo: {},
    }
    const label = `题目 ${problem.displayId}(id=${problem.id})`
    const rows: Diff[] = []
    if (problem.submissionNumber !== want.submissionNumber) {
      rows.push({ label, field: "submission_number", before: problem.submissionNumber, after: want.submissionNumber })
    }
    if (problem.acceptedNumber !== want.acceptedNumber) {
      rows.push({ label, field: "accepted_number", before: problem.acceptedNumber, after: want.acceptedNumber })
    }
    if (stable(objectValue(problem.statisticInfo)) !== stable(want.statisticInfo)) {
      rows.push({ label, field: "statistic_info", before: problem.statisticInfo, after: want.statisticInfo })
    }
    if (rows.length) {
      plan.diffs.push(...rows)
      plan.problemFixes.push({ id: problem.id, value: want })
    }
  }

  for (const profile of profiles) {
    const want = expectedProfile.get(profile.userId) ?? {
      submissionNumber: 0,
      acceptedNumber: 0,
      status: {},
    }
    // acm_problems_status 里除了 problems / contest_problems 之外的键原样保留 ——
    // persistResult 只写这两个桶，别的键是从哪来的没人说得清，重算不该顺手抹掉。
    const existing = objectValue(profile.acmProblemsStatus)
    const merged: Record<string, unknown> = { ...existing }
    delete merged.problems
    delete merged.contest_problems
    for (const [bucket, value] of Object.entries(want.status)) merged[bucket] = value

    const label = `用户 ${profile.userId}`
    const rows: Diff[] = []
    if (profile.submissionNumber !== want.submissionNumber) {
      rows.push({ label, field: "submission_number", before: profile.submissionNumber, after: want.submissionNumber })
    }
    if (profile.acceptedNumber !== want.acceptedNumber) {
      rows.push({ label, field: "accepted_number", before: profile.acceptedNumber, after: want.acceptedNumber })
    }
    if (stable(existing) !== stable(merged)) {
      const keys = new Set([...Object.keys(objectValue(existing.problems)), ...Object.keys(want.status.problems ?? {})])
      rows.push({ label, field: "acm_problems_status", before: `${Object.keys(objectValue(existing.problems)).length} 题`, after: `${keys.size} 题（含比赛桶重建）` })
    }
    if (rows.length) {
      plan.diffs.push(...rows)
      plan.profileFixes.push({ id: profile.id, value: { ...want, merged } })
    }
  }
  await unlockedCountPlan(plan)
  return plan
}

function report(plan: Plan) {
  console.log(`发现 ${plan.diffs.length} 处不一致（题目 ${plan.problemFixes.length} 道 / 用户 ${plan.profileFixes.length} 人 / 已解锁数 ${plan.unlockedCountFixes.length} 人 / 元成就补发 ${plan.metaGrants.length} 条）：`)
  for (const diff of plan.diffs.slice(0, 40)) {
    console.log(`  ${diff.label}  ${diff.field}: ${JSON.stringify(diff.before)} → ${JSON.stringify(diff.after)}`)
  }
  if (plan.diffs.length > 40) console.log(`  ……另有 ${plan.diffs.length - 40} 处`)
}

/** 退出码：0 = 一致或预演正常，1 = 落库后复核仍有差异 */
export async function recount(options: { apply: boolean }) {
  const plan = await computePlan()
  if (plan.diffs.length === 0) {
    console.log("计数列与 submission / user_achievement 一致，没有要订正的。")
    return 0
  }
  report(plan)

  if (!options.apply) {
    console.log("\n以上为预演，没有写库。确认无误后加 --apply 落库。")
    return 0
  }

  await db.transaction(async (tx) => {
    for (const fix of plan.problemFixes) {
      await tx.update(schema.problem).set({
        submissionNumber: fix.value.submissionNumber,
        acceptedNumber: fix.value.acceptedNumber,
        statisticInfo: fix.value.statisticInfo,
      }).where(eq(schema.problem.id, fix.id))
    }
    for (const fix of plan.profileFixes) {
      await tx.update(schema.userProfile).set({
        submissionNumber: fix.value.submissionNumber,
        acceptedNumber: fix.value.acceptedNumber,
        acmProblemsStatus: fix.value.merged,
      }).where(eq(schema.userProfile.id, fix.id))
    }
  })
  // 先改计数、再补发：rescanAchievement 读的是 metrics 里的计数。
  // 补发幂等（唯一键 + 冲突忽略），重跑不会重复发
  const recounted = await refreshUnlockedCount(plan.unlockedCountFixes)
  if (plan.metaGrants.length) {
    for (const meta of await metaAchievements()) await rescanAchievement(meta.id)
  }
  console.log(`\n已订正题目 ${plan.problemFixes.length} 道、用户 ${plan.profileFixes.length} 人、已解锁数 ${recounted.length} 人，补发元成就 ${plan.metaGrants.length} 条，复核中……`)

  // 复核跑的是同一份 computePlan。这里还剩差异说明口径本身有问题（不是数据脏），
  // 必须让部署脚本看见非零退出码，而不是打一行字了事。
  const after = await computePlan()
  if (after.diffs.length === 0) {
    console.log("复核通过：计数列与 submission / user_achievement 一致")
    return 0
  }
  console.error(`复核未通过，仍有 ${after.diffs.length} 处差异：`)
  report(after)
  return 1
}
