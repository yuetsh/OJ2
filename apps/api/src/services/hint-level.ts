import { HINT_LEVEL_COMPILE, HINT_MAX_LEVEL } from "@oj2/contract"
import { and, desc, eq, gt, gte, isNull } from "drizzle-orm"

import { db, schema } from "../db"
import { JudgeStatus } from "../judge/status"

/**
 * AI 提示的等级阶梯（AI 时代 OJ 设计 2.2 / 2.6）。
 *
 * 等级记在**学生 × 题目**上，没有单独的表 —— 它就是 `ai_hint.level` 的历史：
 * 「当前等级」= 这道题上（最近一次 AC 之后）给过的最高一级。这样做的好处是不用再维护
 * 一份会和落库记录对不上的状态，代价是每次都要算一遍，所以只查等级和时间两列。
 *
 * 三条规则，缺一条学生就能白嫖等级：
 *
 * 1. **只有学生点「再多一点提示」才升级**（`more`），不带就按当前等级再生成一次。
 * 2. **升一级要先再交一次**：锚点是「当前这一级是**什么时候**开出来的」，也就是这一级
 *    最早那条提示的 `ai_hint.create_time`；必须存在**比这个时刻更新的提交**才准 +1。
 * 3. **AC 之后清零**：只认最近一次 AC 之后的提交上给过的提示，更早的当不存在。
 *
 * 规则 2 比的是**提示的时刻**、不是提示所在那条提交的时刻 —— 后者能被绕开：端点收谁的
 * 提交 id 都认（只校验归属），拿一条**老提交**去要提示，锚点就退回到那条老提交的时间，
 * 于是「比锚点更新的提交」凭空就有了，连点两下 more 就能从 L0 爬到 L2，一次新提交都不用交。
 * 换成提示时刻之后这条路自然堵死：老提交永远不可能比刚发生的提示更新。
 *
 * 编译失败那一档（`HINT_LEVEL_COMPILE`）既不消耗也不推进等级，查阶梯时按 `level >= 0`
 * 摘掉；2c 上线前那批 `level` 为 null 的提示同样摘掉。生成失败（`error` 非空）的那条
 * 什么内容都没给，也不算数。
 */

/** 最近一次 AC 的时刻；没 AC 过就是 null。AST 未通过不算，那种情况学生还要再改 */
async function lastAcceptedAt(userId: number, problemId: number) {
  const [row] = await db
    .select({ createTime: schema.submission.createTime })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.userId, userId),
        eq(schema.submission.problemId, problemId),
        eq(schema.submission.result, JudgeStatus.ACCEPTED),
      ),
    )
    .orderBy(desc(schema.submission.createTime))
    .limit(1)
  return row?.createTime ?? null
}

/**
 * 这道题上有没有**比 `hintAt` 这个时刻更新**的提交 —— 「升一级要先再交一次」就卡在这里。
 * `hintAt` 是当前这一级开出来的那条提示的时间（见上面的规则 2）。
 */
async function hasNewerSubmission(userId: number, problemId: number, hintAt: string) {
  const [row] = await db
    .select({ id: schema.submission.id })
    .from(schema.submission)
    .where(
      and(
        eq(schema.submission.userId, userId),
        eq(schema.submission.problemId, problemId),
        gt(schema.submission.createTime, hintAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

/**
 * 当前等级和它的锚点（这一级是在什么时候第一次给出来的）。
 * 一道题上的提示条数是个位数，直接全取回来在内存里算，省得写 window function。
 */
async function currentLadder(userId: number, problemId: number) {
  const since = await lastAcceptedAt(userId, problemId)
  const rows = await db
    .select({ level: schema.aiHint.level, hintAt: schema.aiHint.createTime })
    .from(schema.aiHint)
    .innerJoin(schema.submission, eq(schema.aiHint.submissionId, schema.submission.id))
    .where(
      and(
        eq(schema.submission.userId, userId),
        eq(schema.submission.problemId, problemId),
        gte(schema.aiHint.level, 0),
        isNull(schema.aiHint.error),
        since ? gt(schema.submission.createTime, since) : undefined,
      ),
    )
  if (!rows.length) return null
  const level = Math.max(...rows.map((row) => row.level ?? 0))
  // 锚点取这一级**最早**那条：同一级重复给过几次时，锚点不能跟着往后挪，
  // 否则学生每按一次「让 AI 分析」都得多交一次才升得上去
  const anchor = rows
    .filter((row) => row.level === level)
    .map((row) => row.hintAt)
    .sort()[0]!
  return { level, anchor }
}

export interface HintLevelDecision {
  /** 这次要按哪一级生成。`HINT_LEVEL_COMPILE` 不在阶梯上 */
  level: number
  /** 生成完之后，再点一次「再多一点提示」还升不升得动 —— 直接进 done 事件 */
  canEscalate: boolean
}

/**
 * 这次请求按哪一级生成。`submission` 是学生正在看的那一条。
 *
 * `canEscalate` 是**这次生成之后**的状态：刚升完必然是 false —— 新等级的锚点就是这条
 * 提示本身，不可能已经有比它更新的提交。它按「这条提示会落库」算；落库真失败了前端会多
 * 显示一次按钮，再点一下也只是按同一级重生成，不会错升。
 */
export async function decideHintLevel(
  userId: number,
  submission: { problemId: number; result: number; createTime: string },
  more: boolean,
): Promise<HintLevelDecision> {
  // 编译失败自成一档：不看阶梯、不动阶梯，也就没有「再多一点」可点
  if (submission.result === JudgeStatus.COMPILE_ERROR)
    return { level: HINT_LEVEL_COMPILE, canEscalate: false }

  const problemId = submission.problemId
  const ladder = await currentLadder(userId, problemId)
  // 这道题还没开过阶梯：从 L0 起，而这条提示就是 L0 的锚点，不可能已经有更新的提交
  if (!ladder) return { level: 0, canEscalate: false }
  const unlocked =
    ladder.level < HINT_MAX_LEVEL && (await hasNewerSubmission(userId, problemId, ladder.anchor))
  if (more && unlocked) return { level: ladder.level + 1, canEscalate: false }
  return { level: ladder.level, canEscalate: unlocked }
}
