import { createHash } from "node:crypto"

import { and, eq, inArray } from "drizzle-orm"

import { config } from "../config"
import { db, schema } from "../db"
import { publishAchievementNotification } from "../events"
import { updateAchievementsForSubmission } from "../services/achievements"
import { checkAst, type AstRule } from "./ast"
import { publishSubmissionUpdate } from "./events"
import type { JudgeJobData } from "./job"
import { languageConfigs } from "./languages"
import {
  isAccepted,
  JudgeStatus,
  type JudgeStatusValue,
} from "./status"
import { parseProblemTemplate } from "./template"

interface JudgeCase {
  cpu_time: number
  memory: number
  result: number
  test_case: string
  [key: string]: unknown
}

interface JudgeResponse {
  err: string | null
  data: JudgeCase[] | unknown
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function statusValue(value: number): JudgeStatusValue {
  const statuses = new Set<number>(Object.values(JudgeStatus))
  return statuses.has(value)
    ? (value as JudgeStatusValue)
    : JudgeStatus.SYSTEM_ERROR
}

function templateForLanguage(value: unknown, language: string) {
  const template = objectValue(value)[language]
  return typeof template === "string" ? template : null
}

function astRulesForLanguage(value: unknown, language: string): AstRule[] {
  const rules = objectValue(value)[language]
  return Array.isArray(rules) ? (rules as AstRule[]) : []
}

async function requestJudge(
  language: string,
  code: string,
  timeLimit: number,
  memoryLimit: number,
  testCaseId: string,
) {
  const languageConfig = languageConfigs[language]
  if (!languageConfig) throw new Error(`Unsupported judge language: ${language}`)

  const token = createHash("sha256")
    .update(config.judgeServerToken)
    .digest("hex")
  const response = await fetch(new URL("/judge", config.judgeServerUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Judge-Server-Token": token,
    },
    body: JSON.stringify({
      language_config: languageConfig,
      src: code,
      max_cpu_time: timeLimit,
      max_memory: 1024 * 1024 * memoryLimit,
      test_case_id: testCaseId,
      output: false,
      io_mode: {
        io_mode: "Standard IO",
        input: "input.txt",
        output: "output.txt",
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`JudgeServer returned HTTP ${response.status}`)
  }
  return (await response.json()) as JudgeResponse
}

async function persistResult(
  submissionId: string,
  problemId: number,
  userId: number,
  displayId: string,
  result: JudgeStatusValue,
  info: unknown,
  statisticInfo: Record<string, unknown>,
  contestId: number | null,
  submissionCreateTime: string,
) {
  return db.transaction(async (tx) => {
    const [currentSubmission] = await tx
      .select({ result: schema.submission.result })
      .from(schema.submission)
      .where(eq(schema.submission.id, submissionId))
      .for("update")

    if (
      !currentSubmission ||
      ![JudgeStatus.PENDING, JudgeStatus.JUDGING].includes(
        currentSubmission.result as 6 | 7,
      )
    ) {
      return false
    }

    const [problem] = await tx
      .select({
        submissionNumber: schema.problem.submissionNumber,
        acceptedNumber: schema.problem.acceptedNumber,
        statisticInfo: schema.problem.statisticInfo,
      })
      .from(schema.problem)
      .where(eq(schema.problem.id, problemId))
      .for("update")

    const [profile] = await tx
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, userId))
      .for("update")

    if (!problem || !profile) {
      throw new Error("Submission dependencies disappeared during judging")
    }

    await tx
      .update(schema.submission)
      .set({ result, info, statisticInfo })
      .where(eq(schema.submission.id, submissionId))

    const problemStatistics = objectValue(problem.statisticInfo)
    const resultKey = String(result)
    const previousResultCount = problemStatistics[resultKey]
    problemStatistics[resultKey] =
      (typeof previousResultCount === "number" ? previousResultCount : 0) + 1

    await tx
      .update(schema.problem)
      .set({
        submissionNumber: problem.submissionNumber + 1,
        acceptedNumber:
          problem.acceptedNumber + (isAccepted(result) ? 1 : 0),
        statisticInfo: problemStatistics,
      })
      .where(eq(schema.problem.id, problemId))

    const acmStatus = objectValue(profile.acmProblemsStatus)
    const statusKey = contestId === null ? "problems" : "contest_problems"
    const problems = objectValue(acmStatus[statusKey])
    const previous = objectValue(problems[String(problemId)])
    const previousStatus = previous.status
    const wasAccepted =
      typeof previousStatus === "number" && isAccepted(previousStatus)
    const acceptedNow = isAccepted(result)

    if (previousStatus === undefined) {
      problems[String(problemId)] = {
        status: acceptedNow ? JudgeStatus.ACCEPTED : result,
        _id: displayId,
      }
    } else if (!wasAccepted) {
      problems[String(problemId)] = {
        ...previous,
        status: acceptedNow ? JudgeStatus.ACCEPTED : result,
        _id: displayId,
      }
    }
    acmStatus[statusKey] = problems

    await tx
      .update(schema.userProfile)
      .set({
        submissionNumber:
          profile.submissionNumber + (contestId === null ? 1 : 0),
        acceptedNumber:
          profile.acceptedNumber +
          (contestId === null && acceptedNow && !wasAccepted ? 1 : 0),
        acmProblemsStatus: acmStatus,
      })
      .where(eq(schema.userProfile.id, profile.id))

    if (contestId !== null) {
      const [contest] = await tx
        .select({ startTime: schema.contest.startTime })
        .from(schema.contest)
        .where(eq(schema.contest.id, contestId))
        .for("update")
      if (!contest) throw new Error("Contest disappeared during judging")

      await tx
        .insert(schema.acmContestRank)
        .values({
          contestId,
          userId,
          submissionNumber: 0,
          acceptedNumber: 0,
          totalTime: 0,
          submissionInfo: {},
        })
        .onConflictDoNothing({
          target: [schema.acmContestRank.contestId, schema.acmContestRank.userId],
        })

      const [rank] = await tx
        .select()
        .from(schema.acmContestRank)
        .where(
          and(
            eq(schema.acmContestRank.contestId, contestId),
            eq(schema.acmContestRank.userId, userId),
          ),
        )
        .for("update")
      if (!rank) throw new Error("Contest rank could not be created")

      const rankInfo = objectValue(rank.submissionInfo)
      const previousInfo = objectValue(rankInfo[String(problemId)])
      const alreadyAccepted = previousInfo.is_ac === true
      if (!alreadyAccepted) {
        const errorNumber =
          typeof previousInfo.error_number === "number"
            ? previousInfo.error_number
            : 0
        const nextInfo: Record<string, unknown> = {
          is_ac: acceptedNow,
          ac_time: 0,
          error_number:
            errorNumber +
            (!acceptedNow && result !== JudgeStatus.COMPILE_ERROR ? 1 : 0),
          is_first_ac: false,
        }
        let totalTime = rank.totalTime
        let acceptedNumber = rank.acceptedNumber
        if (acceptedNow) {
          const acTime = Math.max(
            0,
            Math.floor(
              (Date.parse(submissionCreateTime) - Date.parse(contest.startTime)) /
                1000,
            ),
          )
          nextInfo.ac_time = acTime
          nextInfo.is_first_ac = problem.acceptedNumber === 0
          acceptedNumber += 1
          totalTime += acTime + errorNumber * 20 * 60
        }
        rankInfo[String(problemId)] = nextInfo
        await tx
          .update(schema.acmContestRank)
          .set({
            submissionNumber: rank.submissionNumber + 1,
            acceptedNumber,
            totalTime,
            submissionInfo: rankInfo,
          })
          .where(eq(schema.acmContestRank.id, rank.id))
      }
    }

    return true
  })
}

async function markSystemError(submissionId: string, userId: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const updated = await db
    .update(schema.submission)
    .set({
      result: JudgeStatus.SYSTEM_ERROR,
      statisticInfo: { err_info: message, score: 0 },
    })
    .where(
      and(
        eq(schema.submission.id, submissionId),
        inArray(schema.submission.result, [
          JudgeStatus.PENDING,
          JudgeStatus.JUDGING,
        ]),
      ),
    )
    .returning({ id: schema.submission.id })

  if (updated.length > 0) {
    await publishSubmissionUpdate(userId, {
      type: "submission_update",
      submission_id: submissionId,
      result: JudgeStatus.SYSTEM_ERROR,
      status: "error",
      err_info: message,
    })
  }
}

export async function judgeSubmission(job: JudgeJobData) {
  const [row] = await db
    .select({
      submission: schema.submission,
      problem: schema.problem,
    })
    .from(schema.submission)
    .innerJoin(schema.problem, eq(schema.submission.problemId, schema.problem.id))
    .where(
      and(
        eq(schema.submission.id, job.submissionId),
        eq(schema.problem.id, job.problemId),
      ),
    )
    .limit(1)

  if (!row) throw new Error(`Submission ${job.submissionId} does not exist`)
  if (![JudgeStatus.PENDING, JudgeStatus.JUDGING].includes(row.submission.result as 6 | 7)) {
    return
  }

  try {
    await db
      .update(schema.submission)
      .set({ result: JudgeStatus.JUDGING })
      .where(eq(schema.submission.id, row.submission.id))
    await publishSubmissionUpdate(row.submission.userId, {
      type: "submission_update",
      submission_id: row.submission.id,
      result: JudgeStatus.JUDGING,
      status: "judging",
    })

    const rawTemplate = templateForLanguage(
      row.problem.template,
      row.submission.language,
    )
    const template = rawTemplate ? parseProblemTemplate(rawTemplate) : null
    const source = template
      ? `${template.prepend}\n${row.submission.code}\n${template.append}`
      : row.submission.code

    const response = await requestJudge(
      row.submission.language,
      source,
      row.problem.timeLimit,
      row.problem.memoryLimit,
      row.problem.testCaseId,
    )

    let result: JudgeStatusValue
    let info: unknown = {}
    let statisticInfo: Record<string, unknown> = {}

    if (response.err) {
      result = JudgeStatus.COMPILE_ERROR
      statisticInfo = {
        err_info:
          typeof response.data === "string"
            ? response.data
            : JSON.stringify(response.data),
        score: 0,
      }
    } else {
      if (!Array.isArray(response.data)) {
        throw new Error("JudgeServer returned an invalid result payload")
      }
      const cases = [...response.data].sort(
        (left, right) => Number(left.test_case) - Number(right.test_case),
      )
      info = { err: null, data: cases }
      const firstFailure = cases.find((item) => item.result !== JudgeStatus.ACCEPTED)
      result = statusValue(firstFailure?.result ?? JudgeStatus.ACCEPTED)
      statisticInfo = {
        time_cost: Math.max(0, ...cases.map((item) => Number(item.cpu_time) || 0)),
        memory_cost: Math.max(0, ...cases.map((item) => Number(item.memory) || 0)),
        score: 0,
      }

      if (result === JudgeStatus.ACCEPTED) {
        const rules = astRulesForLanguage(
          row.problem.astRules,
          row.submission.language,
        )
        if (rules.length > 0) {
          const ast = await checkAst(
            row.submission.code,
            row.submission.language,
            rules,
          )
          if (!ast.passed) {
            result = JudgeStatus.AST_CHECK_FAILED
            statisticInfo.ast_results = ast.results
          }
        }
      }
    }

    const saved = await persistResult(
      row.submission.id,
      row.problem.id,
      row.submission.userId,
      row.problem.displayId,
      result,
      info,
      statisticInfo,
      row.submission.contestId,
      row.submission.createTime,
    )
    if (!saved) return

    try {
      const unlocked = await updateAchievementsForSubmission(row.submission.id)
      await publishAchievementNotification(row.submission.userId, unlocked.map((achievement) => ({
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        rarity: achievement.rarity,
        kind: "achievement",
      })))
    } catch (error) {
      console.error(`Failed to update achievements for ${row.submission.id}`, error)
    }

    await publishSubmissionUpdate(row.submission.userId, {
      type: "submission_update",
      submission_id: row.submission.id,
      result,
      status: "finished",
      time_cost:
        typeof statisticInfo.time_cost === "number"
          ? statisticInfo.time_cost
          : undefined,
      memory_cost:
        typeof statisticInfo.memory_cost === "number"
          ? statisticInfo.memory_cost
          : undefined,
      score:
        typeof statisticInfo.score === "number" ? statisticInfo.score : undefined,
    })
  } catch (error) {
    console.error(`Failed to judge submission ${row.submission.id}`, error)
    await markSystemError(row.submission.id, row.submission.userId, error)
  }
}
