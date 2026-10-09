import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm"

import { db, schema } from "../db"
import { publishAchievementNotification } from "../events"
import { asRecord } from "../routes/helpers"
import { updateAchievementsForProblemSet } from "./achievements"

type BadgeRow = typeof schema.problemsetBadge.$inferSelect
type ProgressRow = typeof schema.problemsetProgress.$inferSelect
type ProblemLink = { problemId: number; isRequired: boolean }
type BadgeCheck = Pick<
  ProgressRow,
  "completedProblemsCount" | "totalProblemsCount" | "progressDetail"
>

/**
 * 题单进度的唯一算法：学生做出一道题后的增量更新、后台改动题目后的批量重算，都走这一份。
 *
 * 以前两边各写一遍，于是各自漂了一段：后台那份不碰 is_completed（加一道题之后分母变大，
 * 人还标着「已完成」）、不清理 progress_detail（删掉一道题之后没做的题被算成做了）。
 * 两边不再分叉的唯一办法是只留一处算法，所以这里做成纯函数，两边都只是调用者。
 */
export function computeProgress(
  detail: Record<string, unknown>,
  links: ProblemLink[],
  previousCompleteTime: string | null,
  now = new Date().toISOString(),
) {
  const inSet = new Set(links.map((link) => String(link.problemId)))
  // 已经移出题单的题目要从 detail 里剔掉，留着它 completed 就会比实际做出的题还多。
  // 老数据的每一项还带着 score（分数已经拿掉了），原样留着无害
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (inSet.has(key)) kept[key] = value
  }
  // 分母只算必做题。「（选做）」这个标签一直只是卡片上的一行字，进度分母和 all_problems
  // 奖章照样要求做完 —— 快照里 22 个人做完了全部必做题，界面却显示未完成、全通奖章也拿不到
  // （题单 5/6/8/11）。选做题做对了照样算进「做对 N 道」奖章，只是不卡完成。
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
  // 每行 6 个参数，留足余量避开 Postgres 的 65535 个绑定参数上限
  for (let start = 0; start < rows.length; start += 1000) {
    const chunk = rows.slice(start, start + 1000)
    const values = sql.join(
      chunk.map(
        (row) => sql`(
        ${row.id}::bigint,
        ${JSON.stringify(row.progressDetail)}::jsonb,
        ${row.totalProblemsCount}::int,
        ${row.completedProblemsCount}::int,
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
        is_completed = v.is_completed,
        complete_time = v.complete_time
      from (values ${values}) as v(
        id, detail, total_count, completed_count, is_completed, complete_time
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
  // 「总分达到 N」随分数一起拿掉了，0026 把它们换成了「做对 N 道」
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
export async function recordSolvedProblem(userId: number, problemId: number, solvedAt: string) {
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

      const detail = asRecord(progress.progressDetail)
      if (String(problemId) in detail) return []
      const links = await tx
        .select({
          problemId: schema.problemsetProblem.problemId,
          isRequired: schema.problemsetProblem.isRequired,
        })
        .from(schema.problemsetProblem)
        .where(eq(schema.problemsetProblem.problemsetId, problemsetId))
      if (!links.some((item) => item.problemId === problemId)) return []
      detail[String(problemId)] = { submit_time: solvedAt }
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
export async function recordSolvedAndNotify(userId: number, problemId: number, solvedAt: string) {
  try {
    const { updated, earned } = await recordSolvedProblem(userId, problemId, solvedAt)
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

/** 题单现在是不是在布置期内。按数据库的钟算（`now()`），和防抄闸门同一个口径 */
export const assigningSql = sql<boolean>`(${schema.problemset.assignedAt} is not null and ${schema.problemset.assignedUntil} > now())`

/**
 * 题单防抄闸门：查出这些题目里，哪些题的旧提交要对该用户藏起来，返回 problemId → 分界时刻
 * （早于它的提交藏起来）。代码提交（routes/submission.ts）和流程图提交（routes/flowchart.ts）
 * 共用这一道闸。
 *
 * 规则（2026-10 题单重设计，用户拍板）：题单**布置期内**，题单里这几道题，学生在**布置开始之前**
 * 交的代码一律先藏起来 —— 不管他加没加入。老师常拿刚讲过的题攒复习题单：快照里 16% 的
 * 「学生 × 题」加入前就做对过，不藏的话把自己以前的答案贴进去就完了。
 *
 * 以前是「加入之后藏加入之前的」，于是先去提交记录里把旧答案复制下来、再点加入，闸就白设了；
 * 现在分界是布置开始，没加入的人也藏，这个口子就没了。代价是别的班以前做过这几道题的人，
 * 在这一两周里也看不到自己的旧代码，用户认了。
 *
 * 解锁的路全写在 where 里，任一成立就查不出来、也就不遮挡：
 *   - 题单不在布置期（没布置，或者布置期过了）
 *   - 题单没公开
 *   - 已经在这份题单里做对了这道题（progress_detail 里有这道题的 key）
 *
 * 一道题可能同时落在几个正在布置的题单里，取最晚的布置开始 ——「任一题单要求遮挡就遮挡」。
 */
export async function problemSetLockCutoffs(userId: number, problemIds: number[]) {
  const cutoffs = new Map<number, string>()
  if (problemIds.length === 0) return cutoffs
  const rows = await db
    .select({
      problemId: schema.problemsetProblem.problemId,
      // 聚合表达式不走列的类型映射，但 OID 还是 1184 —— db/index.ts 给这个 OID 挂了
      // 「转成 ISO 8601」的 parser，所以这里拿到的和 `mode:"string"` 的列同形状
      cutoff: sql<string>`max(${schema.problemset.assignedAt})`,
    })
    .from(schema.problemsetProblem)
    .innerJoin(schema.problemset, eq(schema.problemset.id, schema.problemsetProblem.problemsetId))
    .leftJoin(
      schema.problemsetProgress,
      and(
        eq(schema.problemsetProgress.problemsetId, schema.problemset.id),
        eq(schema.problemsetProgress.userId, userId),
      ),
    )
    .where(
      and(
        inArray(schema.problemsetProblem.problemId, problemIds),
        eq(schema.problemset.visible, true),
        assigningSql,
        sql`not coalesce(jsonb_exists(${schema.problemsetProgress.progressDetail}, ${schema.problemsetProblem.problemId}::text), false)`,
      ),
    )
    .groupBy(schema.problemsetProblem.problemId)
  for (const row of rows) cutoffs.set(row.problemId, row.cutoff)
  return cutoffs
}

/** 这道题的旧代码为什么藏着：它落在哪些正在布置、我还没在里面做对的题单里 */
export async function problemSetLocksFor(userId: number, problemId: number) {
  return db
    .select({
      problemSetId: schema.problemset.id,
      title: schema.problemset.title,
      assignedUntil: sql<string>`${schema.problemset.assignedUntil}`,
    })
    .from(schema.problemsetProblem)
    .innerJoin(schema.problemset, eq(schema.problemset.id, schema.problemsetProblem.problemsetId))
    .leftJoin(
      schema.problemsetProgress,
      and(
        eq(schema.problemsetProgress.problemsetId, schema.problemset.id),
        eq(schema.problemsetProgress.userId, userId),
      ),
    )
    .where(
      and(
        eq(schema.problemsetProblem.problemId, problemId),
        eq(schema.problemset.visible, true),
        assigningSql,
        sql`not coalesce(jsonb_exists(${schema.problemsetProgress.progressDetail}, ${schema.problemsetProblem.problemId}::text), false)`,
      ),
    )
    .orderBy(asc(schema.problemset.assignedUntil))
}
