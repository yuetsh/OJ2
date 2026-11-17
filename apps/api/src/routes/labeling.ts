/**
 * 「数据标注」学生这边：列表、一节（下一条 / 做完的错题）、交一条、看图、老师重来、全班情况。
 * 设计见 docs/specs/2026-11-17-data-labeling-lab-design.md；样子照画布「数据标注」页。
 *
 * 没公开的一节只有老师进得去（拿来试做）。**对错只在服务器判**：页面上拿不到答案，
 * 交一条才回「对 / 不对」，对了才给理由。
 */
import {
  STUDENT_ROLES,
  TEACHER_ROLES,
  answerLabelingRequestSchema,
  type AnswerLabelingResponse,
  type LabelingDetail,
  type LabelingKind,
  type LabelingListItem,
  type LabelingProgress,
} from '@oj2/contract'
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'

import { optionalAuth, requireAuth, requireTeacher, type AppEnv } from '../auth/middleware'
import { db, schema } from '../db'
import { failure, parseBody, success } from '../http'
import { suggestActiveClass } from '../services/class-activity'
import { boxesError, firstCorrect, itemColumns, judge, spansError, type ItemRow } from '../services/labeling'
import { adminItem } from './admin/labeling'
import { queryInteger } from './helpers'

export const labelingRoutes = new Hono<AppEnv>()

function isTeacher(c: Context<AppEnv>) {
  const user = c.get('user')
  return !!user && TEACHER_ROLES.includes(user.adminType)
}

/** 这一节：学生只能看公开的，老师都能看 */
async function findLabeling(c: Context<AppEnv>) {
  const [labeling] = await db
    .select()
    .from(schema.labeling)
    .where(eq(schema.labeling.id, queryInteger(c.req.param('id'), 0, { min: 1 })))
    .limit(1)
  if (!labeling || (!labeling.isPublic && !isTeacher(c))) return null
  return labeling
}

function selectItems(labelingIds: number[]) {
  if (!labelingIds.length) return Promise.resolve([])
  return db
    .select(itemColumns)
    .from(schema.labelingItem)
    .where(inArray(schema.labelingItem.labelingId, labelingIds))
    .orderBy(asc(schema.labelingItem.order), asc(schema.labelingItem.id))
}

function myAnswers(userId: number | undefined, labelingIds: number[]) {
  if (!userId || !labelingIds.length) return Promise.resolve([])
  return db
    .select()
    .from(schema.labelingAnswer)
    .where(and(eq(schema.labelingAnswer.userId, userId), inArray(schema.labelingAnswer.labelingId, labelingIds)))
}

type AnswerRow = typeof schema.labelingAnswer.$inferSelect

/** 一个人在一节上的情况：标对了几条、下一条是哪条、做完了的话一次就对几条 */
function summarize(kind: LabelingKind, items: ItemRow[], answers: Map<number, AnswerRow>) {
  const passed = items.filter((item) => answers.get(item.id)?.passedAt)
  const nextIndex = items.findIndex((item) => !answers.get(item.id)?.passedAt)
  const done = items.length > 0 && nextIndex < 0
  const correct = done ? items.filter((item) => firstCorrect(kind, item, answers.get(item.id)!)) : []
  return { passedCount: passed.length, nextIndex, done, correct }
}

labelingRoutes.get('/labelings', optionalAuth, async (c) => {
  const user = c.get('user')
  const labelings = await db
    .select({ id: schema.labeling.id, title: schema.labeling.title, kind: schema.labeling.kind, isPublic: schema.labeling.isPublic })
    .from(schema.labeling)
    .where(isTeacher(c) ? undefined : eq(schema.labeling.isPublic, true))
    .orderBy(asc(schema.labeling.order), asc(schema.labeling.id))
  const ids = labelings.map((l) => l.id)
  const [items, answers] = await Promise.all([selectItems(ids), myAnswers(user?.id, ids)])
  const answerMap = new Map(answers.map((a) => [a.itemId, a]))
  return success(
    c,
    labelings.map((l) => {
      const mine = items.filter((item) => item.labelingId === l.id)
      const s = summarize(l.kind, mine, answerMap)
      return {
        ...l,
        itemCount: mine.length,
        passedCount: s.passedCount,
        firstCorrect: s.done ? s.correct.length : null,
      } satisfies LabelingListItem
    }),
  )
})

labelingRoutes.get('/labelings/:id', optionalAuth, async (c) => {
  const labeling = await findLabeling(c)
  if (!labeling) return failure(c, 404, 'labeling-not-found', '这一节不存在')
  const user = c.get('user')
  const [items, answers] = await Promise.all([selectItems([labeling.id]), myAnswers(user?.id, [labeling.id])])
  const answerMap = new Map(answers.map((a) => [a.itemId, a]))
  const s = summarize(labeling.kind, items, answerMap)
  const next = s.nextIndex >= 0 ? items[s.nextIndex]! : null
  return success(c, {
    id: labeling.id,
    title: labeling.title,
    description: labeling.description,
    kind: labeling.kind,
    labels: labeling.labels,
    isPublic: labeling.isPublic,
    total: items.length,
    passedCount: s.passedCount,
    canReset: !!user && !STUDENT_ROLES.includes(user.adminType),
    current: next ? { id: next.id, index: s.nextIndex + 1, text: next.text, hasImage: next.imageType !== null } : null,
    result: s.done
      ? {
          firstCorrect: s.correct.length,
          wrong: items
            .filter((item) => !s.correct.includes(item))
            .map((item) => {
              const a = answerMap.get(item.id)!
              return {
                id: item.id,
                text: item.text,
                hasImage: item.imageType !== null,
                answer: item.answer,
                spans: item.spans,
                firstLabel: a.firstLabel,
                firstSpans: a.firstSpans,
                boxes: item.boxes,
                firstBoxes: a.firstBoxes,
                reason: item.reason,
              }
            }),
        }
      : null,
  } satisfies LabelingDetail)
})

/**
 * 只能往前（设计文档第 8 节）：学生只能碰已经标对的和「下一条」（第一条还没标对的），后面的交不了、图也看不了。
 * 原来只靠页面不给按钮，条目 id 是自增的，猜着发请求就能跳着做。老师不拦（出题页、全班情况都要看所有的图）。
 * 没登录的人看公开的一节只看得到第一条（和一节页面给的 current 一致）。
 */
async function reachable(c: Context<AppEnv>, labelingId: number, itemId: number) {
  if (isTeacher(c)) return true
  const [items, answers] = await Promise.all([selectItems([labelingId]), myAnswers(c.get('user')?.id, [labelingId])])
  const passed = new Set(answers.filter((a) => a.passedAt).map((a) => a.itemId))
  if (passed.has(itemId)) return true
  return items.find((item) => !passed.has(item.id))?.id === itemId
}

/** 找到这一节里的这一条 */
async function findItem(c: Context<AppEnv>) {
  const labeling = await findLabeling(c)
  if (!labeling) return null
  const [item] = await db
    .select(itemColumns)
    .from(schema.labelingItem)
    .where(and(eq(schema.labelingItem.id, queryInteger(c.req.param('itemId'), 0, { min: 1 })), eq(schema.labelingItem.labelingId, labeling.id)))
    .limit(1)
  return item ? { labeling, item } : null
}

/**
 * 交一条。第一次交的内容记下来（统计用），之后只累计错的次数；标对了记时间，之后再交都按对处理。
 * 只能往前：前面还有没标对的就不收（见 reachable）。
 */
labelingRoutes.post('/labelings/:id/items/:itemId/answer', requireAuth, async (c) => {
  const found = await findItem(c)
  if (!found) return failure(c, 404, 'labeling-item-not-found', '这一条不存在')
  if (!(await reachable(c, found.labeling.id, found.item.id))) return failure(c, 409, 'not-current-item', '先把前面的标完，刷新一下')
  const parsed = await parseBody(c, answerLabelingRequestSchema)
  if (!parsed.success) return parsed.response
  const { labeling, item } = found
  const given = parsed.data
  if (labeling.kind === 'span') {
    const error = spansError(item.text, given.spans ?? [], labeling.labels, '')
    if (error) return failure(c, 400, 'invalid-answer', error)
  } else if (labeling.kind === 'box') {
    const error = boxesError(given.boxes ?? [], labeling.labels, '')
    if (error) return failure(c, 400, 'invalid-answer', error)
  } else {
    if (given.label === undefined || !labeling.labels.includes(given.label)) return failure(c, 400, 'invalid-answer', '没有这个标签')
    if (item.answer === null) return failure(c, 400, 'no-answer', '这一条老师还没定标签')
  }
  const userId = c.get('user')!.id
  const [existing] = await db
    .select({ passedAt: schema.labelingAnswer.passedAt })
    .from(schema.labelingAnswer)
    .where(and(eq(schema.labelingAnswer.userId, userId), eq(schema.labelingAnswer.itemId, item.id)))
    .limit(1)
  const reason = item.reason || null
  if (existing?.passedAt) return success(c, { correct: true, feedback: null, reason } satisfies AnswerLabelingResponse)

  const { correct, feedback } = judge(labeling.kind, item, given)
  const now = new Date().toISOString()
  await db
    .insert(schema.labelingAnswer)
    .values({
      userId,
      itemId: item.id,
      labelingId: labeling.id,
      firstLabel: labeling.kind === 'text' || labeling.kind === 'image' ? given.label! : null,
      firstSpans: labeling.kind === 'span' ? (given.spans ?? []) : null,
      firstBoxes: labeling.kind === 'box' ? (given.boxes ?? []) : null,
      wrongCount: correct ? 0 : 1,
      passedAt: correct ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    // 不是第一次：第一次交的内容不动，只累计错的次数、记标对的时间
    .onConflictDoUpdate({
      target: [schema.labelingAnswer.userId, schema.labelingAnswer.itemId],
      set: {
        wrongCount: sql`${schema.labelingAnswer.wrongCount} + ${correct ? 0 : 1}`,
        passedAt: correct ? sql`coalesce(${schema.labelingAnswer.passedAt}, ${now})` : sql`${schema.labelingAnswer.passedAt}`,
        updatedAt: now,
      },
    })
  return success(c, { correct, feedback, reason: correct ? reason : null } satisfies AnswerLabelingResponse)
})

/** 老师试做完「重来」：清掉自己这一节的作答。学生没有这个按钮，接口也不认学生 */
labelingRoutes.post('/labelings/:id/reset', requireAuth, async (c) => {
  const user = c.get('user')!
  if (STUDENT_ROLES.includes(user.adminType)) return failure(c, 403, 'forbidden', '学生不能重来')
  const labeling = await findLabeling(c)
  if (!labeling) return failure(c, 404, 'labeling-not-found', '这一节不存在')
  await db.delete(schema.labelingAnswer).where(and(eq(schema.labelingAnswer.userId, user.id), eq(schema.labelingAnswer.labelingId, labeling.id)))
  return success(c, null)
})

/**
 * 图片。要带登录态（没公开的一节只有老师看得到），所以前端用 authFetch 取回来再显示，
 * 不能直接 <img src>。图只增不改，按条目 id 缓存一天。
 */
labelingRoutes.get('/labelings/:id/items/:itemId/image', optionalAuth, async (c) => {
  const labeling = await findLabeling(c)
  if (!labeling) return failure(c, 404, 'labeling-not-found', '这一节不存在')
  const [row] = await db
    .select({ image: schema.labelingItem.image, imageType: schema.labelingItem.imageType })
    .from(schema.labelingItem)
    .where(and(eq(schema.labelingItem.id, queryInteger(c.req.param('itemId'), 0, { min: 1 })), eq(schema.labelingItem.labelingId, labeling.id)))
    .limit(1)
  if (!row?.image || !row.imageType) return failure(c, 404, 'image-not-found', '这张图不存在')
  if (!(await reachable(c, labeling.id, queryInteger(c.req.param('itemId'), 0, { min: 1 })))) {
    return failure(c, 404, 'image-not-found', '这张图不存在') // 还没轮到的不给看，也不说有没有
  }
  return new Response(new Uint8Array(row.image), {
    headers: { 'content-type': row.imageType, 'cache-control': 'private, max-age=86400' },
  })
})

// ---------------------------------------------------------------- 老师：全班情况

/**
 * 一个班在这一节上的作答。不指定班：先看做过这一节的班里人最多的，没人做过就猜正在上课的班。
 * 「按人」「按数据」两种看法都在前端算 —— 口径要随界面调，放前端改起来不用动接口。
 */
labelingRoutes.get('/labelings/:id/progress', requireTeacher, async (c) => {
  const labeling = await findLabeling(c)
  if (!labeling) return failure(c, 404, 'labeling-not-found', '这一节不存在')
  const users = sql<number>`count(distinct ${schema.labelingAnswer.userId})::int`
  const [items, classRows] = await Promise.all([
    selectItems([labeling.id]),
    db
      .select({ className: schema.user.className, users })
      .from(schema.labelingAnswer)
      .innerJoin(schema.user, eq(schema.user.id, schema.labelingAnswer.userId))
      .where(and(eq(schema.labelingAnswer.labelingId, labeling.id), isNotNull(schema.user.className), inArray(schema.user.adminType, [...STUDENT_ROLES])))
      .groupBy(schema.user.className)
      .orderBy(desc(users)),
  ])
  const classes = classRows.flatMap((r) => (r.className ? [r.className] : []))
  const className = c.req.query('className')?.trim() || classes[0] || (await suggestActiveClass())

  const students = className
    ? await db
        .select({ id: schema.user.id, username: schema.user.username, className: schema.user.className })
        .from(schema.user)
        .where(and(eq(schema.user.className, className), eq(schema.user.isDisabled, false), inArray(schema.user.adminType, [...STUDENT_ROLES])))
        .orderBy(asc(schema.user.username))
    : []
  const answers = students.length
    ? await db
        .select()
        .from(schema.labelingAnswer)
        .where(
          and(
            eq(schema.labelingAnswer.labelingId, labeling.id),
            inArray(
              schema.labelingAnswer.userId,
              students.map((s) => s.id),
            ),
          ),
        )
    : []
  const cell = new Map(answers.map((a) => [`${a.userId}:${a.itemId}`, a]))
  return success(c, {
    className,
    classes,
    kind: labeling.kind,
    labels: labeling.labels,
    items: items.map(adminItem),
    students: students.map((u) => ({
      ...u,
      cells: items.map((item) => {
        const a = cell.get(`${u.id}:${item.id}`)
        return {
          firstLabel: a?.firstLabel ?? null,
          firstSpans: a?.firstSpans ?? null,
          firstBoxes: a?.firstBoxes ?? null,
          wrongCount: a?.wrongCount ?? 0,
          passed: !!a?.passedAt,
        }
      }),
    })),
  } satisfies LabelingProgress)
})
