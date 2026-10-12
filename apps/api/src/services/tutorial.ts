import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"

import { db, schema } from "../db"

/** 「去做几道题」里优先推荐、要标出来的那批题挂的标签 */
export const MUST_DO_TAG = "必会题"

const PROJECT_RE = /\*\*所属项目[：:]\s*([^*\n]+)\*\*/

/**
 * 从正文第一段的「**所属项目：项目三 · 智慧农业·蜜橘园**」抽出项目名，抽不到给空串。
 * 和 0031 迁移回填用的是同一个写法；发布脚本不传 `project` 时靠它。
 */
export function projectFromContent(content: string) {
  return (content.match(PROJECT_RE)?.[1] ?? "").trim().slice(0, 64)
}

/**
 * 放进 select 列表的关联子查询**一律手写表别名**：drizzle 在 select 列表里渲染列时
 * 会省掉表名，子查询里的 `"id"` 要么报 ambiguous，要么就近绑到子查询自己的表上 ——
 * 后一种不报错，只是数全错。外层表也写死成 `"problem"` / `"tutorial"`。
 */

/** 这道题带不带「必会题」标签，做成 select 里的一列 */
export const mustDoColumn = sql<boolean>`exists (
  select 1 from "problem_tags" pt join "problem_tag" t on t."id" = pt."problemtag_id"
  where pt."problem_id" = "problem"."id" and t."name" = ${MUST_DO_TAG}
)`

/** 这道题的全部标签名 */
export const problemTagNames = sql<string[]>`coalesce((
  select array_agg(t."name" order by t."name")
  from "problem_tags" pt join "problem_tag" t on t."id" = pt."problemtag_id"
  where pt."problem_id" = "problem"."id"
), '{}')`

/** 一课有几道练一练 / 挂了几道题 */
export const exerciseCountColumn = sql<number>`(
  select count(*) from "exercise" e where e."tutorial_id" = "tutorial"."id"
)`.mapWith(Number)
export const problemCountColumn = sql<number>`(
  select count(*) from "tutorial_problem" tp where tp."tutorial_id" = "tutorial"."id"
)`.mapWith(Number)

/**
 * 几课各挂了哪些题，按老师排的顺序。`publicOnly` 给学生端用：没公开的题、比赛题不出现
 * （老师挑的时候公开、后来藏起来了的，学生点进去只会 404）。
 */
export async function tutorialProblems(tutorialIds: number[], publicOnly: boolean) {
  if (tutorialIds.length === 0) return []
  return db
    .select({
      tutorialId: schema.tutorialProblem.tutorialId,
      id: schema.problem.id,
      displayId: schema.problem.displayId,
      title: schema.problem.title,
      mustDo: mustDoColumn,
    })
    .from(schema.tutorialProblem)
    .innerJoin(schema.problem, eq(schema.problem.id, schema.tutorialProblem.problemId))
    .where(
      and(
        inArray(schema.tutorialProblem.tutorialId, tutorialIds),
        publicOnly
          ? and(eq(schema.problem.visible, true), isNull(schema.problem.contestId))
          : undefined,
      ),
    )
    .orderBy(asc(schema.tutorialProblem.tutorialId), asc(schema.tutorialProblem.order))
}
