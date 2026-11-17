import { z } from 'zod'

import { sampleUserSchema } from './common'

/**
 * 「数据标注」（代码里叫 labeling）：学生当一回标注员。设计见 docs/specs/2026-11-17-data-labeling-lab-design.md。
 * 实验室板块，试验性质 —— 自成一块，将来下线就是删这个文件和 labeling 开头的那几处。
 *
 * 三种类型，一节只放一种：
 * - text：文字分类，一条文字选一个标签；
 * - image：图片分类，一张图选一个标签；
 * - span：实体标注，在一句话里标出几段字（人名、地名…），每段一个类别；
 * - box：框选，在一张图上框出所有要标的东西，每个框一个类别（设计文档 3.6 节，只做电脑）。
 */
export const LABELING_KINDS = ['text', 'image', 'span', 'box'] as const
export type LabelingKind = (typeof LABELING_KINDS)[number]

export const LABELING_MIN_LABELS = 2
export const LABELING_MAX_LABELS = 6
export const LABELING_MAX_LABEL_LENGTH = 10
export const LABELING_MAX_ITEMS = 50
/** 超过这么多条只提示（一节课可能做不完），不拦 */
export const LABELING_SUGGESTED_ITEMS = 20
export const LABELING_MAX_TEXT = 500
export const LABELING_MAX_SPAN_TEXT = 300
export const LABELING_MAX_REASON = 500
/** 浏览器里先缩到长边 1280 再传，这是缩完之后的上限 */
export const LABELING_IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const LABELING_IMAGE_MAX_SIDE = 1280

/**
 * 实体标注的一段：第 start 个字到第 end 个字之前（end 不含），按**字**数（Array.from 拆出来的，
 * 不是 UTF-16 码元），前后端都这么数。
 */
export const labelingSpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  label: z.string(),
})

export type LabelingSpan = z.infer<typeof labelingSpanSchema>

/**
 * 框选的一个框。坐标按图片的比例存（左上角 x、y，宽 w、高 h，都在 0–1 之间），和图在屏幕上显示多大无关。
 */
export const labelingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
  label: z.string(),
})

export type LabelingBox = z.infer<typeof labelingBoxSchema>

/** 学生的框和答案的框重合多少算对：交并比 ≥ 这个数（设计文档 3.6 节第 2 条，以后可改） */
export const LABELING_BOX_IOU = 0.5

// ---------------------------------------------------------------- 判对错（前后端共用）

export function sortSpans(spans: LabelingSpan[]) {
  return [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
}

export function spansEqual(a: LabelingSpan[], b: LabelingSpan[]) {
  if (a.length !== b.length) return false
  const x = sortSpans(a)
  const y = sortSpans(b)
  return x.every((s, i) => s.start === y[i]!.start && s.end === y[i]!.end && s.label === y[i]!.label)
}

/** 实体标注的错：漏标、类别不对、范围不对（和答案那段有交叠但首尾不一样）、多标 */
export interface SpanMistake {
  kind: 'missing' | 'label' | 'range' | 'extra'
  /** 漏标 / 类别不对 / 范围不对：答案里那段；多标：学生标的那段 */
  span: LabelingSpan
  /** 类别不对时学生标成的类别 */
  got?: string
}

function overlaps(a: LabelingSpan, b: LabelingSpan) {
  return a.start < b.end && b.start < a.end
}

export function spanMistakes(answer: LabelingSpan[], given: LabelingSpan[]): SpanMistake[] {
  const mistakes: SpanMistake[] = []
  const used = new Set<LabelingSpan>()
  for (const a of sortSpans(answer)) {
    const same = given.find((g) => g.start === a.start && g.end === a.end)
    if (same) {
      used.add(same)
      if (same.label !== a.label) mistakes.push({ kind: 'label', span: a, got: same.label })
      continue
    }
    const near = given.filter((g) => overlaps(g, a))
    if (near.length) {
      near.forEach((g) => used.add(g))
      mistakes.push({ kind: 'range', span: a })
    } else {
      mistakes.push({ kind: 'missing', span: a })
    }
  }
  for (const g of sortSpans(given)) {
    if (!used.has(g)) mistakes.push({ kind: 'extra', span: g })
  }
  return mistakes
}

/** 给学生的那句话：只说哪类问题、各几处，不说是哪个词（设计文档 3.5 节第 1 条） */
export function spanFeedback(mistakes: SpanMistake[]) {
  const count = (kind: SpanMistake['kind']) => mistakes.filter((m) => m.kind === kind).length
  const parts: string[] = []
  if (count('missing')) parts.push(`还少标了 ${count('missing')} 处`)
  if (count('label')) parts.push(`有 ${count('label')} 处类别不对`)
  if (count('range')) parts.push(`有 ${count('range')} 处标的字多了或少了`)
  if (count('extra')) parts.push(`多标了 ${count('extra')} 处`)
  return parts.join('，')
}

// ---------------------------------------------------------------- 框选判对错（前后端共用）

/** 交并比：两个框重叠的面积 ÷ 两个框合起来的面积 */
export function boxIou(a: Omit<LabelingBox, 'label'>, b: Omit<LabelingBox, 'label'>) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  return inter / (a.w * a.h + b.w * b.h - inter)
}

/** 框选的错：漏框、类别不对、框歪了（碰到了但重合不到一半）、多框 */
export interface BoxMistake {
  kind: 'missing' | 'label' | 'range' | 'extra'
  /** 漏框 / 类别不对 / 框歪了：答案里那个框；多框：学生画的那个框 */
  box: LabelingBox
  /** 答案里第几个框（多框时没有） */
  index?: number
  /** 类别不对时学生选的类别 */
  got?: string
}

/**
 * 最大权匹配（匈牙利算法）：w 是 n 行 m 列、n ≤ m，返回每一行配到第几列。
 * 框最多 100 个，O(n²m) 也就百万次，判一条的时候现算不费事。
 */
function maxWeightAssignment(w: number[][], n: number, m: number): number[] {
  const u = Array<number>(n + 1).fill(0)
  const v = Array<number>(m + 1).fill(0)
  const p = Array<number>(m + 1).fill(0)
  const way = Array<number>(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = Array<number>(m + 1).fill(Infinity)
    const used = Array<boolean>(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]!
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = -w[i0 - 1]![j - 1]! - u[i0]! - v[j]!
        if (cur < minv[j]!) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j]! < delta) {
          delta = minv[j]!
          j1 = j
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!]! += delta
          v[j]! -= delta
        } else {
          minv[j]! -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]!
      p[j0] = p[j1]!
      j0 = j1
    } while (j0)
  }
  const match = Array<number>(n).fill(-1)
  for (let j = 1; j <= m; j++) if (p[j]) match[p[j]! - 1] = j - 1
  return match
}

/**
 * 先一对一配对，再看每一对：重合够一半比类别，不够一半算框歪了；答案里没配上的算漏框，学生画的没配上的算多框。
 *
 * 配对要整体最优，不能按重合度从高到低先到先得：两个答案框叠得多时（人骑在车上），学生的「车」框可能和答案的
 * 「人」框重合得更多，先到先得会把它配走，画对了也判成「类别不对 + 框歪了」。所以按这个先后取最好的一组配对：
 * 全对的对数最多 → 其次重合够一半的最多 → 其次碰到了的最多 → 最后重合度加起来最大。每一档的权重比下一档
 * 最多 100 对加起来还大，一次最大权匹配就能分出先后。
 */
export function boxMistakes(answer: LabelingBox[], given: LabelingBox[]): BoxMistake[] {
  const weight = (a: LabelingBox, g: LabelingBox) => {
    const iou = boxIou(a, g)
    if (iou <= 0) return 0
    if (iou < LABELING_BOX_IOU) return 1e3 + iou
    return (a.label === g.label ? 1e9 : 1e6) + iou
  }
  const usedA = new Map<number, { g: number; iou: number }>()
  const usedG = new Set<number>()
  const pair = (ai: number, gi: number) => {
    const iou = boxIou(answer[ai]!, given[gi]!)
    if (iou <= 0) return // 一点没碰到的硬配上了也不算一对：漏一个 + 多一个
    usedA.set(ai, { g: gi, iou })
    usedG.add(gi)
  }
  if (answer.length && given.length) {
    if (answer.length <= given.length) {
      const w = answer.map((a) => given.map((g) => weight(a, g)))
      maxWeightAssignment(w, answer.length, given.length).forEach((gi, ai) => gi >= 0 && pair(ai, gi))
    } else {
      const w = given.map((g) => answer.map((a) => weight(a, g)))
      maxWeightAssignment(w, given.length, answer.length).forEach((ai, gi) => ai >= 0 && pair(ai, gi))
    }
  }
  const mistakes: BoxMistake[] = []
  answer.forEach((a, index) => {
    const pair = usedA.get(index)
    if (!pair) return mistakes.push({ kind: 'missing', box: a, index })
    if (pair.iou < LABELING_BOX_IOU) return mistakes.push({ kind: 'range', box: a, index })
    const got = given[pair.g]!.label
    if (got !== a.label) mistakes.push({ kind: 'label', box: a, index, got })
  })
  given.forEach((g, gi) => {
    if (!usedG.has(gi)) mistakes.push({ kind: 'extra', box: g })
  })
  return mistakes
}

/** 给学生的那句话：只说哪类问题、各几个，不说是哪个框 */
export function boxFeedback(mistakes: BoxMistake[]) {
  const count = (kind: BoxMistake['kind']) => mistakes.filter((m) => m.kind === kind).length
  const parts: string[] = []
  if (count('missing')) parts.push(`还少框了 ${count('missing')} 个`)
  if (count('label')) parts.push(`有 ${count('label')} 个框类别不对`)
  if (count('range')) parts.push(`有 ${count('range')} 个框歪了`)
  if (count('extra')) parts.push(`多框了 ${count('extra')} 个`)
  return parts.join('，')
}

/** 一段在句子里是哪几个字 */
export function spanText(text: string, span: { start: number; end: number }) {
  return Array.from(text).slice(span.start, span.end).join('')
}

// ---------------------------------------------------------------- 后台

const label = z.string().trim().min(1).max(LABELING_MAX_LABEL_LENGTH)

export const createLabelingRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  kind: z.enum(LABELING_KINDS),
})

export const reorderLabelingsRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
})

/**
 * 出题页整节一起存。条目按数组顺序排：带 id 的改、不带的建（只有文字和实体标注能这么建，
 * 图片要先传）、原来有而这次没出现的删掉，连同学生在那一条的作答。
 * 语义上的要求（标签在标签集里、段不重叠、公开时都定了答案…）不挂在 zod 上，见 api 的 labelingSaveError()。
 */
export const labelingItemInputSchema = z.object({
  id: z.number().int().positive().optional(),
  text: z.string().max(LABELING_MAX_TEXT),
  /** 分类的正确标签；还没选是 null（只有图片会这样）。实体标注恒为 null */
  answer: z.string().nullable(),
  /** 实体标注的答案；分类恒为空 */
  spans: z.array(labelingSpanSchema).max(100),
  /** 框选的答案；别的类型恒为空 */
  boxes: z.array(labelingBoxSchema).max(100).default([]),
  reason: z.string().max(LABELING_MAX_REASON),
})

export const saveLabelingRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  description: z.string().max(5000),
  isPublic: z.boolean(),
  labels: z.array(label).max(LABELING_MAX_LABELS),
  items: z.array(labelingItemInputSchema).max(LABELING_MAX_ITEMS),
})

export const adminLabelingItemSchema = z.object({
  id: z.number().int(),
  text: z.string(),
  hasImage: z.boolean(),
  answer: z.string().nullable(),
  spans: z.array(labelingSpanSchema),
  boxes: z.array(labelingBoxSchema),
  reason: z.string(),
})

export const adminLabelingSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  kind: z.enum(LABELING_KINDS),
  labels: z.array(z.string()),
  isPublic: z.boolean(),
  items: z.array(adminLabelingItemSchema),
  createdBy: sampleUserSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminLabelingListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  kind: z.enum(LABELING_KINDS),
  isPublic: z.boolean(),
  itemCount: z.number().int(),
  /** 动过手的学生数 */
  students: z.number().int(),
  createdBy: sampleUserSchema,
  updatedAt: z.string(),
})

// ---------------------------------------------------------------- 学生这边

export const labelingListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  kind: z.enum(LABELING_KINDS),
  itemCount: z.number().int(),
  /** 当前学生标对了几条；没登录是 0 */
  passedCount: z.number().int(),
  /** 全做完时第一次就对了几条（做完了才有，没做完是 null） */
  firstCorrect: z.number().int().nullable(),
  isPublic: z.boolean(),
})

/** 现在要做的那一条。不带答案 —— 对错在服务器判（设计文档第 4 节） */
export const labelingCurrentItemSchema = z.object({
  id: z.number().int(),
  /** 第几条，从 1 数 */
  index: z.number().int(),
  text: z.string(),
  hasImage: z.boolean(),
})

/** 做完后的错题：第一次没对的那几条，带答案、第一次的作答和理由 */
export const labelingWrongItemSchema = z.object({
  id: z.number().int(),
  text: z.string(),
  hasImage: z.boolean(),
  answer: z.string().nullable(),
  spans: z.array(labelingSpanSchema),
  firstLabel: z.string().nullable(),
  firstSpans: z.array(labelingSpanSchema).nullable(),
  boxes: z.array(labelingBoxSchema),
  firstBoxes: z.array(labelingBoxSchema).nullable(),
  reason: z.string(),
})

export const labelingDetailSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  kind: z.enum(LABELING_KINDS),
  labels: z.array(z.string()),
  isPublic: z.boolean(),
  total: z.number().int(),
  passedCount: z.number().int(),
  /** 老师、学生管理员以外的非学生角色：结果页多「重来」，接口也只认他们 */
  canReset: z.boolean(),
  /** 还没做完：下一条要做的。做完了 / 一条都没有是 null */
  current: labelingCurrentItemSchema.nullable(),
  /** 做完了：一次就对几条 + 错题。没做完是 null */
  result: z
    .object({
      firstCorrect: z.number().int(),
      wrong: z.array(labelingWrongItemSchema),
    })
    .nullable(),
})

/** 交一条：分类交 label，实体标注交 spans，框选交 boxes */
export const answerLabelingRequestSchema = z.object({
  label: z.string().max(LABELING_MAX_LABEL_LENGTH).optional(),
  spans: z.array(labelingSpanSchema).max(100).optional(),
  boxes: z.array(labelingBoxSchema).max(100).optional(),
})

export const answerLabelingResponseSchema = z.object({
  correct: z.boolean(),
  /** 错了说什么：分类是「不对，再看看」，实体标注说哪类问题 */
  feedback: z.string().nullable(),
  /** 对了才给 */
  reason: z.string().nullable(),
})

// ---------------------------------------------------------------- 老师：全班情况

export const labelingProgressCellSchema = z.object({
  /** 第一次交的是什么；没交过是 null（分类看 firstLabel，实体标注看 firstSpans，框选看 firstBoxes） */
  firstLabel: z.string().nullable(),
  firstSpans: z.array(labelingSpanSchema).nullable(),
  firstBoxes: z.array(labelingBoxSchema).nullable(),
  wrongCount: z.number().int(),
  passed: z.boolean(),
})

export const labelingProgressSchema = z.object({
  className: z.string().nullable(),
  classes: z.array(z.string()),
  kind: z.enum(LABELING_KINDS),
  labels: z.array(z.string()),
  /** 带答案（老师看的） */
  items: z.array(adminLabelingItemSchema),
  students: z.array(
    z.object({
      id: z.number().int(),
      username: z.string(),
      className: z.string().nullable(),
      /** 和 items 一一对应 */
      cells: z.array(labelingProgressCellSchema),
    }),
  ),
})

export type CreateLabelingRequest = z.infer<typeof createLabelingRequestSchema>
export type ReorderLabelingsRequest = z.infer<typeof reorderLabelingsRequestSchema>
export type LabelingItemInput = z.infer<typeof labelingItemInputSchema>
export type SaveLabelingRequest = z.infer<typeof saveLabelingRequestSchema>
export type AdminLabelingItem = z.infer<typeof adminLabelingItemSchema>
export type AdminLabeling = z.infer<typeof adminLabelingSchema>
export type AdminLabelingListItem = z.infer<typeof adminLabelingListItemSchema>
export type LabelingListItem = z.infer<typeof labelingListItemSchema>
export type LabelingCurrentItem = z.infer<typeof labelingCurrentItemSchema>
export type LabelingWrongItem = z.infer<typeof labelingWrongItemSchema>
export type LabelingDetail = z.infer<typeof labelingDetailSchema>
export type AnswerLabelingRequest = z.infer<typeof answerLabelingRequestSchema>
export type AnswerLabelingResponse = z.infer<typeof answerLabelingResponseSchema>
export type LabelingProgressCell = z.infer<typeof labelingProgressCellSchema>
export type LabelingProgress = z.infer<typeof labelingProgressSchema>
