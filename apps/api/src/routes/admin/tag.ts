import {
  parseFlowDoc,
  batchProblemTagRequestSchema,
  batchProblemVisibleRequestSchema,
  generateFlowchartRequestSchema,
  renameTagRequestSchema,
  setTagCategoryRequestSchema,
  type AdminTag,
  type BatchProblemTagResponse,
  type GenerateFlowchartResponse,
  type RenameTagResponse,
} from '@oj2/contract'
import { and, asc, countDistinct, desc, eq, ilike, inArray, isNull, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireProblemPermission, type AppEnv } from '../../auth/middleware'
import { db, schema } from '../../db'
import { failure, parseBody, success } from '../../http'
import { completeChat } from '../../services/ai'
import { asRecord, queryInteger } from '../helpers'
import { canEditProblem, canManageAllProblems } from '../../services/permissions'
import { findTagsByName, normalizeTagNames } from '../../services/problem-tags'

export const adminTagRoutes = new Hono<AppEnv>()

/** 能管所有题目：超管，或 problemPermission 为 All */

// ---------------------------------------------------------------- 标签

adminTagRoutes.get('/problem-tags', requireProblemPermission, async (c) => {
  const keyword = c.req.query('keyword')?.trim()
  const rows = await db
    .select({
      id: schema.problemTag.id,
      name: schema.problemTag.name,
      category: schema.problemTag.category,
      categoryConfirmed: schema.problemTag.categoryConfirmed,
      problemCount: countDistinct(schema.problemTags.problemId),
    })
    .from(schema.problemTag)
    .leftJoin(schema.problemTags, eq(schema.problemTags.problemtagId, schema.problemTag.id))
    .where(keyword ? ilike(schema.problemTag.name, `%${keyword}%`) : undefined)
    .groupBy(schema.problemTag.id)
    // 后台标签管理要看到 problemCount=0 的标签（正是要清理的那些），
    // 所以这里用 leftJoin 且不加 having —— oj 侧的 /problem-tags 才过滤 >0。
    // 待归类的新标签排最前面（false 在 true 之前），不然会沉在几十个老标签底下
    .orderBy(asc(schema.problemTag.categoryConfirmed), desc(countDistinct(schema.problemTags.problemId)), asc(schema.problemTag.name))
  return success(c, rows satisfies AdminTag[])
})

adminTagRoutes.put('/problem-tags/:id', requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, renameTagRequestSchema, '标签名不能为空')
  if (!parsed.success) return parsed.response
  const name = parsed.data.name

  const [tag] = await db.select().from(schema.problemTag).where(eq(schema.problemTag.id, id)).limit(1)
  if (!tag) return failure(c, 404, 'tag-not-found', '标签不存在，请刷新后重试')

  const [target] = await db
    .select()
    .from(schema.problemTag)
    .where(and(sql`lower(${schema.problemTag.name}) = lower(${name})`, ne(schema.problemTag.id, id)))
    .limit(1)

  if (!target) {
    await db.update(schema.problemTag).set({ name }).where(eq(schema.problemTag.id, id))
    return success(c, {
      merged: false,
      id,
      name,
      affectedCount: 0,
    } satisfies RenameTagResponse)
  }

  // 改名撞上已有标签，视为合并：题目关系转移过去，原标签删除
  const affected = await db.transaction(async (tx) => {
    const links = await tx.select({ problemId: schema.problemTags.problemId }).from(schema.problemTags).where(eq(schema.problemTags.problemtagId, id))
    const already = new Set(
      (await tx.select({ problemId: schema.problemTags.problemId }).from(schema.problemTags).where(eq(schema.problemTags.problemtagId, target.id))).map(
        (row) => row.problemId,
      ),
    )
    // 只给还没挂目标标签的题目补关系，否则会撞 (problem_id, problemtag_id) 唯一约束
    const missing = links.filter((link) => !already.has(link.problemId))
    if (missing.length) {
      await tx.insert(schema.problemTags).values(
        missing.map((link) => ({
          problemId: link.problemId,
          problemtagId: target.id,
        })),
      )
    }
    // 旧标签上剩下的关系行随标签一起没：problem_tags.problemtag_id 是 CASCADE（0010）。
    // 上面那批 insert 已经把题目挂到 target 上了，这里删掉的只是旧的那一份关系。
    await tx.delete(schema.problemTag).where(eq(schema.problemTag.id, id))
    return links.length
  })
  return success(c, {
    merged: true,
    id: target.id,
    name: target.name,
    affectedCount: affected,
  } satisfies RenameTagResponse)
})

adminTagRoutes.put('/problem-tags/:id/category', requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const parsed = await parseBody(c, setTagCategoryRequestSchema, '分类只能是知识点或主题')
  if (!parsed.success) return parsed.response
  const [row] = await db
    .update(schema.problemTag)
    // 选了分类就算确认过，哪怕选的还是默认的「知识点」
    .set({ category: parsed.data.category, categoryConfirmed: true })
    .where(eq(schema.problemTag.id, id))
    .returning({ id: schema.problemTag.id })
  if (!row) return failure(c, 404, 'tag-not-found', '标签不存在，请刷新后重试')
  return success(c, null)
})

adminTagRoutes.delete('/problem-tags/:id', requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  // 中间表 problem_tags 随标签一起清：problemtag_id 是 CASCADE（0010）
  const deleted = await db.delete(schema.problemTag).where(eq(schema.problemTag.id, id)).returning({ id: schema.problemTag.id })
  if (deleted.length === 0) return failure(c, 404, 'tag-not-found', '标签不存在，请刷新后重试')
  return success(c, null)
})

adminTagRoutes.post('/problems/batch-tag', requireProblemPermission, async (c) => {
  const parsed = await parseBody(c, batchProblemTagRequestSchema)
  if (!parsed.success) return parsed.response
  const user = c.get('user')!
  const filters = [inArray(schema.problem.id, parsed.data.problemIds), isNull(schema.problem.contestId)]
  if (!canManageAllProblems(user)) filters.push(eq(schema.problem.createdById, user.id))
  const problems = await db
    .select({ id: schema.problem.id })
    .from(schema.problem)
    .where(and(...filters))
  if (problems.length === 0) return failure(c, 404, 'no-problems', '没有可操作的题目')

  // 去重且大小写不敏感，与旧 resolve_tags / find_tags 一致
  const wanted = normalizeTagNames(parsed.data.tagNames)

  const tagIds = await db.transaction(async (tx) => {
    const existing = await findTagsByName(tx, wanted)
    // 添加时按需新建标签，移除时只认已有标签 —— 否则「移除」会顺手造出一堆空标签
    if (parsed.data.action === 'add') {
      const missing = wanted.filter((name) => !existing.has(name.toLowerCase()))
      if (missing.length) {
        const created = await tx
          .insert(schema.problemTag)
          .values(missing.map((name) => ({ name })))
          .returning({
            id: schema.problemTag.id,
            name: schema.problemTag.name,
          })
        for (const row of created) existing.set(row.name.toLowerCase(), row.id)
      }
    }
    return wanted.map((name) => existing.get(name.toLowerCase())).filter((id) => id !== undefined)
  })
  if (tagIds.length === 0) return failure(c, 404, 'no-tags', '没有匹配的标签')

  const problemIds = problems.map((problem) => problem.id)
  await db.transaction(async (tx) => {
    if (parsed.data.action === 'remove') {
      await tx.delete(schema.problemTags).where(and(inArray(schema.problemTags.problemId, problemIds), inArray(schema.problemTags.problemtagId, tagIds)))
      return
    }
    const existing = await tx
      .select()
      .from(schema.problemTags)
      .where(and(inArray(schema.problemTags.problemId, problemIds), inArray(schema.problemTags.problemtagId, tagIds)))
    const have = new Set(existing.map((row) => `${row.problemId}:${row.problemtagId}`))
    const rows = []
    for (const problemId of problemIds) {
      for (const tagId of tagIds) {
        if (!have.has(`${problemId}:${tagId}`)) rows.push({ problemId, problemtagId: tagId })
      }
    }
    if (rows.length) await tx.insert(schema.problemTags).values(rows)
  })

  return success(c, {
    problemCount: problems.length,
    tagCount: tagIds.length,
  } satisfies BatchProblemTagResponse)
})

// ---------------------------------------------------------------- 题目可见性

adminTagRoutes.put('/problems/:id/visibility', requireProblemPermission, async (c) => {
  const id = queryInteger(c.req.param('id'), 0, { min: 1 })
  const [problem] = await db
    .select({
      id: schema.problem.id,
      visible: schema.problem.visible,
      createdById: schema.problem.createdById,
      contestId: schema.problem.contestId,
    })
    .from(schema.problem)
    .where(eq(schema.problem.id, id))
    .limit(1)
  // 旧后端这里的 `self.error(...)` 少写了 return，题目不存在时会继续往下跑并抛
  // AttributeError（500）。这里正常返回 404。
  if (!problem) return failure(c, 404, 'problem-not-found', '题目不存在')
  const user = c.get('user')!
  // 和编辑、删除同一个口径（canEdit）：比赛题看比赛的创建者。原来只看题目的创建者，
  // 而从题库加进比赛的题保留原作者，老师在自己比赛里点「可见」一律 404
  if (!(await canEditProblem(user, problem))) {
    return failure(c, 404, 'problem-not-found', '题目不存在')
  }
  await db.update(schema.problem).set({ visible: !problem.visible }).where(eq(schema.problem.id, id))
  return success(c, { visible: !problem.visible })
})

/**
 * 勾了几道，一次让学生看得到 / 藏起来（后台题目列表「已选 N 道」那一条）。
 * 和批量加标签同一个范围：只认公开题，不是全部题目管理员就只认自己出的
 */
adminTagRoutes.post('/problems/batch-visible', requireProblemPermission, async (c) => {
  const parsed = await parseBody(c, batchProblemVisibleRequestSchema)
  if (!parsed.success) return parsed.response
  const user = c.get('user')!
  const filters = [inArray(schema.problem.id, parsed.data.problemIds), isNull(schema.problem.contestId)]
  if (!canManageAllProblems(user)) filters.push(eq(schema.problem.createdById, user.id))
  const updated = await db
    .update(schema.problem)
    .set({ visible: parsed.data.visible })
    .where(and(...filters))
    .returning({ id: schema.problem.id })
  if (updated.length === 0) return failure(c, 404, 'no-problems', '没有可操作的题目')
  return success(c, { problemCount: updated.length })
})

// ---------------------------------------------------------------- Python → 流程图

/**
 * 照标准答案画参考流程图。原来让 AI 直接写 Mermaid，老师拿到的是一段代码，要改只能改代码；
 * 现在出结构树，后台画布直接摆上去，和学生画图是同一个编辑器
 */
const PYTHON_TO_FLOWCHART = `把下面这段 Python 标准答案画成流程图，给中职学生看。只返回 JSON：{"steps":[…]}
每一步是下面五种之一（开始、结束不用写）：
{"kind":"input","text":"输入 n"}
{"kind":"output","text":"输出 a（保留两位小数）"}
{"kind":"process","text":"i = i + 1"}
{"kind":"if","text":"a > b","yes":[…],"no":[…]}
{"kind":"while","text":"i < 365","body":[…]}
- 框里写中文和简单的式子，像课本上那样；不要写 input、print、int、range 这些函数名
- for 循环改成计数变量 + while：先一个处理框给变量赋初值，while 写条件，循环体最后一个处理框让变量加一
- elif 写成 else 里再套一个 if
- break、continue、函数定义尽量改写成等价的顺序 / 判断 / 循环；实在改不了就用一个处理框写一句说明`

adminTagRoutes.post('/problems/flowchart', requireProblemPermission, async (c) => {
  const parsed = await parseBody(c, generateFlowchartRequestSchema, 'python 代码不能为空')
  if (!parsed.success) return parsed.response
  try {
    const reply = asRecord(JSON.parse(await completeChat(PYTHON_TO_FLOWCHART, parsed.data.python, { json: true })))
    const doc = parseFlowDoc({ version: 2, steps: reply.steps })
    if (!doc || !doc.steps.length) throw new Error('AI returned no flowchart steps')
    return success(c, { doc: { ...doc } } satisfies GenerateFlowchartResponse)
  } catch (error) {
    console.error('Flowchart generation failed', error)
    return failure(c, 502, 'ai-unavailable', '生成失败，请稍后再试')
  }
})
