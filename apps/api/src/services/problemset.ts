import { and, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { publishAchievementNotification } from "../events"
import { asRecord } from "../routes/helpers"
import { updateAchievementsForProblemSet } from "./achievements"

type BadgeRow = typeof schema.problemsetBadge.$inferSelect
type ProgressRow = typeof schema.problemsetProgress.$inferSelect
type ProblemLink = { problemId: number; score: number; isRequired: boolean }
type BadgeCheck = Pick<
  ProgressRow,
  "completedProblemsCount" | "totalProblemsCount" | "totalScore" | "progressDetail"
>

/**
 * 题单进度的唯一算法：学生做出一道题后的增量更新、后台改动题目后的批量重算，都走这一份。
 *
 * 以前两边各写一遍，于是各自漂了一段。后台那份（resyncProgress）只更新分母和百分比：
 *   - 改题目分值时调了它，可它根本不碰 total_score，score 类奖章按陈旧分数判定；
 *   - 不碰 is_completed，加一道题之后分母变大、百分比掉下来，人还标着「已完成」；
 *   - 不清理 progress_detail，删掉一道题之后 least(completed, total) 会把没做的题算成做了。
 * 两边不再分叉的唯一办法是只留一处算法，所以这里做成纯函数，两边都只是调用者。
 */
export function computeProgress(
  detail: Record<string, unknown>,
  links: ProblemLink[],
  previousCompleteTime: string | null,
  now = new Date().toISOString(),
) {
  const scoreByProblem = new Map(links.map((link) => [String(link.problemId), link.score]))
  // 已经移出题单的题目要从 detail 里剔掉，留着它 completed 就会比实际做出的题还多
  const kept: Record<string, unknown> = {}
  let totalScore = 0
  for (const [key, value] of Object.entries(detail)) {
    const score = scoreByProblem.get(key)
    if (score === undefined) continue
    totalScore += score
    // 分值以题单当前的设置为准，detail 里存的是做出那一刻的快照
    kept[key] = { ...asRecord(value), score }
  }
  // 分母只算必做题。「（选做）」这个标签一直只是卡片上的一行字，进度分母和 all_problems
  // 奖章照样要求做完 —— 快照里 22 个人做完了全部必做题，界面却显示未完成、全通奖章也拿不到
  // （题单 5/6/8/11）。选做题做了仍然计分（totalScore 把它算进去），只是不卡完成。
  //
  // 一道必做都没标的题单退回「全部都算必做」：那种题单多半是没用这个字段，而不是
  // 真的整单选做；不兜住的话它永远完不成。
  const required = links.filter((link) => link.isRequired)
  const graded = required.length ? required : links
  const gradedKeys = new Set(graded.map((link) => String(link.problemId)))
  const completed = Object.keys(kept).filter((key) => gradedKeys.has(key)).length
  const total = graded.length
  // total > 0 这个前提不能省：0 === 0 同样成立，没有题目的题单会让人一加入就算「完成」，
  // 还会写下 complete_time、计进「完成题单数」成就，而且后面补上题目也不会自愈。
  const isCompleted = total > 0 && completed === total
  return {
    progressDetail: kept,
    totalProblemsCount: total,
    completedProblemsCount: completed,
    totalScore,
    // 乘 10000 四舍五入再除 100，保留两位小数
    progressPercentage: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
    isCompleted,
    // 只设不清，语义是「曾经完成于」，对齐旧栈 problemset/models.py:218。
    //
    // 「未完成 + 有完成时间」是允许的组合，快照里就有 4 条 —— 题单 8 那批人在它
    // 还只有 6 题时完成过，老师后来加到 12 题，进度退回未完成，完成时间留了下来。
    // 反过来清空的代价是不可逆：往一个 100 人已完成的题单里加一道题、再改主意删掉，
    // 这 100 个人的历史完成时间就一起被冲成了「现在」。
    completeTime: previousCompleteTime ?? (isCompleted ? now : null),
  }
}

type ProgressWrite = ReturnType<typeof computeProgress> & { id: number }

/**
 * 一条 UPDATE 刷完整批参与者。逐行 update 的话一个班的题单就是上百次往返，
 * 而每行要写的值都已经在内存里算好了，没有一个依赖数据库现有的值。
 */
async function writeProgress(rows: ProgressWrite[]) {
  // 每行 8 个参数，留足余量避开 Postgres 的 65535 个绑定参数上限
  for (let start = 0; start < rows.length; start += 1000) {
    const chunk = rows.slice(start, start + 1000)
    const values = sql.join(
      chunk.map(
        (row) => sql`(
        ${row.id}::bigint,
        ${JSON.stringify(row.progressDetail)}::jsonb,
        ${row.totalProblemsCount}::int,
        ${row.completedProblemsCount}::int,
        ${row.totalScore}::int,
        ${row.progressPercentage}::double precision,
        ${row.isCompleted}::boolean,
        ${row.completeTime}::timestamptz
      )`,
      ),
      sql`, `,
    )
    await db.execute(sql`
      update ${schema.problemsetProgress} as pg set
        progress_detail = v.detail,
        total_problems_count = v.total_count,
        completed_problems_count = v.completed_count,
        total_score = v.total_score,
        progress_percentage = v.percentage,
        is_completed = v.is_completed,
        complete_time = v.complete_time
      from (values ${values}) as v(
        id, detail, total_count, completed_count, total_score, percentage, is_completed, complete_time
      )
      where pg.id = v.id
    `)
  }
}

/**
 * 奖章达标判定的唯一实现。学生做出一题、后台改题单、补发脚本三处都调它 ——
 * 以前是三份各写一遍。
 *
 * problem_count 数的是**做出的题目总数（含选做）**，不是 completedProblemsCount
 * （自从分母只算必做，那个只数必做题）。老师当初是按题单的总题数设阈值的：题单 5
 * 的「一职欧拉」要 8 题，而它的必做只有 7 道 —— 改用必做计数会让这枚奖章一夜之间
 * 不可得，76 个已经拿到的人被 recalculateBadge 收回。
 */
export function eligibleForBadge(badge: BadgeRow, progress: BadgeCheck) {
  if (badge.conditionType === "all_problems") {
    return (
      progress.totalProblemsCount > 0 &&
      progress.completedProblemsCount === progress.totalProblemsCount
    )
  }
  if (badge.conditionType === "problem_count") {
    return Object.keys(asRecord(progress.progressDetail)).length >= badge.conditionValue
  }
  if (badge.conditionType === "score") return progress.totalScore >= badge.conditionValue
  return false
}

/**
 * 重算某枚奖章的获得者，对齐旧 `recalculate_user_badges`（由 post_save 信号触发）。
 * 保留已有记录的 earnedTime —— 只增删差集，不是先清空再重建，
 * 否则每改一次条件所有人的获得时间都会刷新成今天。
 *
 * 调用方手里已经有最新的进度时把它传进来（`known`），省掉一次回表；
 * 更要紧的是别用刚写完库之前的旧值去判定。
 */
export async function recalculateBadge(
  badge: BadgeRow,
  known?: (BadgeCheck & { userId: number })[],
) {
  const progresses =
    known ??
    (await db
      .select()
      .from(schema.problemsetProgress)
      .where(eq(schema.problemsetProgress.problemsetId, badge.problemsetId)))
  const eligibleIds = progresses
    .filter((item) => eligibleForBadge(badge, item))
    .map((item) => item.userId)
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.userBadge)
      .where(
        and(
          eq(schema.userBadge.badgeId, badge.id),
          eligibleIds.length ? notInArray(schema.userBadge.userId, eligibleIds) : undefined,
        ),
      )
    if (!eligibleIds.length) return
    const existing = await tx
      .select({ userId: schema.userBadge.userId })
      .from(schema.userBadge)
      .where(eq(schema.userBadge.badgeId, badge.id))
    const have = new Set(existing.map((item) => item.userId))
    const missing = eligibleIds.filter((id) => !have.has(id))
    if (missing.length) {
      await tx.insert(schema.userBadge).values(
        missing.map((userId) => ({
          userId,
          badgeId: badge.id,
          earnedTime: new Date().toISOString(),
        })),
      )
    }
  })
}

/**
 * 题目集或分值变动后，把所有参与者的进度整体重算一遍，再重算这份题单的奖章。
 *
 * 别信「旧后端不做这件事」那个说法（本仓早先的注释里有，是错的）：旧栈用 signals 做了，
 * 而且两件事都做 —— problemset/signals.py 在 ProblemSetProblem 的 post_save / post_delete
 * 上重算全部参与者的进度、再重算该题单全部奖章的资格。重写时 views 里看不到显式调用，
 * 就当成没做，于是奖章那一半漏了，生产快照里攒下 53 条应发未发（30 名学生）。
 *
 * 那 53 条里有 23 条另有出处：旧栈的管理命令 fix_problemset_progress 按实际 AC 记录补
 * progress_detail，可 signals 只挂在 ProblemSetProblem 和 ProblemSetBadge 上、不挂 Progress，
 * 所以进度补了、奖章一枚没补。OJ2 这边目前也还没有补进度的对应工具。
 */
export async function resyncProgress(problemsetId: number) {
  const [links, progresses, badges] = await Promise.all([
    db
      .select({
        problemId: schema.problemsetProblem.problemId,
        score: schema.problemsetProblem.score,
        isRequired: schema.problemsetProblem.isRequired,
      })
      .from(schema.problemsetProblem)
      .where(eq(schema.problemsetProblem.problemsetId, problemsetId)),
    db
      .select()
      .from(schema.problemsetProgress)
      .where(eq(schema.problemsetProgress.problemsetId, problemsetId)),
    db
      .select()
      .from(schema.problemsetBadge)
      .where(eq(schema.problemsetBadge.problemsetId, problemsetId)),
  ])
  const now = new Date().toISOString()
  const updated = progresses.map((progress) => ({
    ...progress,
    ...computeProgress(asRecord(progress.progressDetail), links, progress.completeTime, now),
  }))
  if (updated.length) await writeProgress(updated)
  for (const badge of badges) await recalculateBadge(badge, updated)
}

/**
 * 判题通过后，把这道题记进该用户所有「已加入且包含这道题」的题单。
 *
 * 以前这件事由前端做：SubmitCode.vue 看到 AC 就回调 PUT /problem-set-progress，而且只回调
 * 路由参数里那一个题单。于是从普通题库入口做出同一道题不计进度、网络一抖进度就静默丢失；
 * 旧栈为此专门有个管理命令 fix_problemset_progress 定期按实际提交补账，2026-05-22 那次
 * 批量补进度就是它跑的（而它不补奖章，53 条漏发里的 23 条由此而来）。
 *
 * 挪到判题这一路之后，记账和判题在同一个事务链里，前端只管显示。
 *
 * 不按 visible / status 过滤：进度是学生自己的记录，老师把题单藏起来不该让它停止累积。
 */
export async function recordSolvedProblem(
  userId: number,
  problemId: number,
  /**
   * 做出来的那次代码提交。流程图画到 A/S 算完成时传 null：problemset_submission.submission_id
   * 外键指向代码提交表，流程图提交的 id 进不去。不影响「解锁加入题单之前的提交」——
   * 那道闸看的是 progress_detail（routes/submission.ts 的 problemSetJoinTimes）
   */
  submissionId: string | null,
  solvedAt: string,
) {
  const joined = await db
    .select({ problemsetId: schema.problemsetProgress.problemsetId })
    .from(schema.problemsetProgress)
    .innerJoin(
      schema.problemsetProblem,
      and(
        eq(schema.problemsetProblem.problemsetId, schema.problemsetProgress.problemsetId),
        eq(schema.problemsetProblem.problemId, problemId),
      ),
    )
    .where(eq(schema.problemsetProgress.userId, userId))
  const earned: BadgeRow[] = []
  let updated = 0
  for (const { problemsetId } of joined) {
    const hits = await db.transaction(async (tx) => {
      const [progress] = await tx
        .select()
        .from(schema.problemsetProgress)
        .where(
          and(
            eq(schema.problemsetProgress.problemsetId, problemsetId),
            eq(schema.problemsetProgress.userId, userId),
          ),
        )
        .for("update")
        .limit(1)
      if (!progress) return []

      // 提交记录先补上，即使这道题早就记过 —— 老数据里有记了进度没记提交的行
      const [existing] = await tx
        .select({ id: schema.problemsetSubmission.id })
        .from(schema.problemsetSubmission)
        .where(
          and(
            eq(schema.problemsetSubmission.problemsetId, problemsetId),
            eq(schema.problemsetSubmission.userId, userId),
            eq(schema.problemsetSubmission.problemId, problemId),
          ),
        )
        .limit(1)
      if (!existing && submissionId !== null) {
        await tx
          .insert(schema.problemsetSubmission)
          .values({ problemsetId, userId, submissionId, problemId })
      }

      const detail = asRecord(progress.progressDetail)
      if (String(problemId) in detail) return []
      const links = await tx
        .select({
          problemId: schema.problemsetProblem.problemId,
          score: schema.problemsetProblem.score,
          isRequired: schema.problemsetProblem.isRequired,
        })
        .from(schema.problemsetProblem)
        .where(eq(schema.problemsetProblem.problemsetId, problemsetId))
      const link = links.find((item) => item.problemId === problemId)
      if (!link) return []
      detail[String(problemId)] = { score: link.score, submit_time: solvedAt }
      const update = computeProgress(detail, links, progress.completeTime)
      await tx
        .update(schema.problemsetProgress)
        .set(update)
        .where(eq(schema.problemsetProgress.id, progress.id))
      updated += 1

      const badges = await tx
        .select()
        .from(schema.problemsetBadge)
        .where(eq(schema.problemsetBadge.problemsetId, problemsetId))
      const eligible = badges.filter((badge) => eligibleForBadge(badge, { ...progress, ...update }))
      if (eligible.length === 0) return []
      // 达标的奖章一次插完，冲突忽略后 returning 回来的就是这次真拿到的
      const inserted = await tx
        .insert(schema.userBadge)
        .values(
          eligible.map((badge) => ({
            userId,
            badgeId: badge.id,
            earnedTime: new Date().toISOString(),
          })),
        )
        .onConflictDoNothing({
          target: [schema.userBadge.badgeId, schema.userBadge.userId],
        })
        .returning({ badgeId: schema.userBadge.badgeId })
      const ids = new Set(inserted.map((row) => row.badgeId))
      return eligible.filter((badge) => ids.has(badge.id))
    })
    earned.push(...hits)
  }
  return { updated, earned }
}

/**
 * 记题单进度，并把这一下拿到的徽章、解锁的题单类成就推给学生。判题（judge/run.ts）和
 * 流程图评分（flowchart/run.ts）两条路都在「这道题做完了」的那一刻调它。
 * 记账失败不往外抛：判题 / 评分本身已经落库，不能因为进度没记上就把整次判题算失败。
 */
export async function recordSolvedAndNotify(
  userId: number,
  problemId: number,
  submissionId: string | null,
  solvedAt: string,
) {
  try {
    const { updated, earned } = await recordSolvedProblem(userId, problemId, submissionId, solvedAt)
    if (earned.length > 0) {
      await publishAchievementNotification(
        userId,
        earned.map((badge) => ({
          id: badge.id,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          rarity: "bronze",
          kind: "badge",
        })),
      )
    }
    if (updated > 0) {
      const unlocked = await updateAchievementsForProblemSet(userId)
      await publishAchievementNotification(
        userId,
        unlocked.map((achievement) => ({
          id: achievement.id,
          name: achievement.name,
          description: achievement.description,
          icon: achievement.icon,
          rarity: achievement.rarity,
          kind: "achievement",
        })),
      )
    }
  } catch (error) {
    console.error(
      `Failed to record problem set progress for user ${userId} problem ${problemId}`,
      error,
    )
  }
}

/**
 * 题单防作弊闸门：查出这些题目里，哪些题的旧提交要对该用户藏起来，返回 problemId → 加入时间。
 * 代码提交（routes/submission.ts）和流程图提交（routes/flowchart.ts）共用这一道闸。
 *
 * 对齐旧后端 `submission/serializers.py:12` 的 `bulk_fetch_problemset_progress`。学生加入含
 * 某道题的题单后，他在加入之前留下的 AC 代码还摆在提交列表里，复制粘贴就能把题单刷完。
 * 备份快照里 1734 人次、188 名学生进过这个窗口（占已解题次的 22.5%），不是边角情况。
 *
 * 解锁的三条路全写在 where 里，任一成立就查不出来、也就不遮挡：
 *   - 已经在题单里做出这道题（progress_detail 里有这道题的 key）
 *   - 题单过了截止时间（end_time；为空表示不设期限，只能靠做出来解锁）
 *   - 题单被归档（status 不是 active）
 *
 * 一道题可能同时落在多个已加入的题单里，取最晚的 join_time——「存在任一题单要求遮挡就遮挡」
 * 等价于「提交时间早于最晚的那次加入」。旧后端这里用 `.first()` 取任意一条，一题多题单时
 * 行为不确定，换成聚合顺手定死。
 */
export async function problemSetJoinTimes(userId: number, problemIds: number[]) {
  const joinTimes = new Map<number, string>()
  if (problemIds.length === 0) return joinTimes
  const rows = await db
    .select({
      problemId: schema.problemsetProblem.problemId,
      // 聚合表达式不走列的类型映射，但 OID 还是 1184 —— db/index.ts 给这个 OID 挂了
      // 「转成 ISO 8601」的 parser，所以这里拿到的和 `mode:"string"` 的列同形状。
      // 原来那个 `::text` 要撤掉：它的 OID 是 25、绕过那个 parser，反而会变成 PG 文本。
      joinTime: sql<string>`max(${schema.problemsetProgress.joinTime})`,
    })
    .from(schema.problemsetProgress)
    .innerJoin(schema.problemset, eq(schema.problemset.id, schema.problemsetProgress.problemsetId))
    .innerJoin(
      schema.problemsetProblem,
      eq(schema.problemsetProblem.problemsetId, schema.problemset.id),
    )
    .where(
      and(
        eq(schema.problemsetProgress.userId, userId),
        inArray(schema.problemsetProblem.problemId, problemIds),
        eq(schema.problemset.status, "active"),
        or(isNull(schema.problemset.endTime), gt(schema.problemset.endTime, sql`now()`)),
        sql`not jsonb_exists(${schema.problemsetProgress.progressDetail}, ${schema.problemsetProblem.problemId}::text)`,
      ),
    )
    .groupBy(schema.problemsetProblem.problemId)
  for (const row of rows) joinTimes.set(row.problemId, row.joinTime)
  return joinTimes
}
