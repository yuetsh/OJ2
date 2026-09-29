import { TRIAL_MAX_CASES, trialRunRequestSchema, type TrialRunResponse } from "@oj2/contract"
import { and, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"

import { requireAuth, type AppEnv } from "../auth/middleware"
import { db, schema } from "../db"
import { failure, parseBody, success } from "../http"
import { templateForLanguage } from "../judge/run"
import { parseProblemTemplate } from "../judge/template"
import { runTrial, TrialBusyError, TrialUserLimitError } from "../judge/trial"
import { canAccessContest, findAccessibleContest } from "../services/contest"
import { isAdminRole } from "./helpers"

export const trialRunRoutes = new Hono<AppEnv>()

/** 后台生成测试点时题目可能还没存，没有题目的限制可用，按这两个跑 */
const ADMIN_TIME_LIMIT = 3000
const ADMIN_MEMORY_LIMIT = 256

/**
 * 试运行，见 judge/trial.ts。不落库、不算提交、不走令牌桶 ——
 * 令牌桶是提交的，试运行扣它的话学生多点几次「运行例子」就交不上了；
 * 这里的闸是 trial.ts 里的排队和每人两批的上限。
 */
trialRunRoutes.post("/trial-runs", requireAuth, async (c) => {
  const parsed = await parseBody(c, trialRunRequestSchema, "试运行的参数不对")
  if (!parsed.success) return parsed.response
  const body = parsed.data
  const user = c.get("user")!
  const admin = isAdminRole(user)

  if (!admin && body.cases.length > TRIAL_MAX_CASES) {
    return failure(c, 400, "too-many-cases", `一次最多试运行 ${TRIAL_MAX_CASES} 组`)
  }

  let timeLimit = ADMIN_TIME_LIMIT
  let memoryLimit = ADMIN_MEMORY_LIMIT
  let source = body.code
  let prependLines = 0
  if (body.problemId === undefined) {
    if (!admin) return failure(c, 403, "permission-denied", "请从题目页试运行")
  } else {
    let contestId: number | null = null
    if (body.contestId) {
      const contest = await findAccessibleContest(user, body.contestId)
      if (!contest) return failure(c, 404, "contest-not-found", "比赛不存在")
      const access = await canAccessContest(c, contest, "problems")
      if (!access.ok) return failure(c, 403, access.code, access.message)
      contestId = contest.id
    }
    const [problem] = await db
      .select({
        languages: schema.problem.languages,
        timeLimit: schema.problem.timeLimit,
        memoryLimit: schema.problem.memoryLimit,
        template: schema.problem.template,
        visible: schema.problem.visible,
      })
      .from(schema.problem)
      .where(
        and(
          eq(schema.problem.id, body.problemId),
          contestId === null
            ? isNull(schema.problem.contestId)
            : eq(schema.problem.contestId, contestId),
        ),
      )
      .limit(1)
    // 管理员在后台预览没公开的题，也要能试运行
    if (!problem || (!problem.visible && !admin)) {
      return failure(c, 404, "problem-not-found", "题目不存在")
    }
    if (!problem.languages.includes(body.language)) {
      return failure(c, 400, "language-not-allowed", `这道题不能用 ${body.language}`)
    }
    timeLimit = problem.timeLimit
    memoryLimit = problem.memoryLimit
    // 和提交一样套上题目的代码模板（judgeSubmission），不然有模板的题试运行和提交跑的不是同一份代码
    const rawTemplate = templateForLanguage(problem.template, body.language)
    const template = rawTemplate ? parseProblemTemplate(rawTemplate) : null
    if (template) {
      source = `${template.prepend}\n${body.code}\n${template.append}`
      prependLines = template.prepend.split("\n").length
    }
  }

  try {
    const result = await runTrial({
      userId: user.id,
      language: body.language,
      source,
      code: body.code,
      prependLines,
      timeLimit,
      memoryLimit,
      cases: body.cases,
      fullOutput: admin,
    })
    return success(c, result satisfies TrialRunResponse)
  } catch (error) {
    if (error instanceof TrialUserLimitError) {
      return failure(c, 429, "trial-in-progress", "上一次还没跑完，稍等一下")
    }
    if (error instanceof TrialBusyError) {
      return failure(c, 429, "trial-busy", "现在试运行的人太多了，过一会儿再点")
    }
    console.error("Trial run failed", error)
    return failure(c, 502, "judge-unavailable", "判题机暂时连不上")
  }
})
