import { z } from 'zod'

import { sampleUserSchema } from './common'

/**
 * 「训练模型」（代码里叫 model-training）：老师给一批埋了毛病的训练数据，学生找出毛病、改好数据，
 * 让文字分类模型在「最后考」里到达标线。设计见 docs/specs/2026-11-17-model-training-lab-design.md。
 * 实验室板块，试验性质 —— 自成一块，将来下线就是删这个文件和 model-training 开头的那几处。
 *
 * 数据分三份（split）：
 * - train：训练数据。学生看得到「给学生的标签」（shown），可以改、删、补；「正确标签」（answer）达标后才揭开。
 *   两个标签不一样的就是老师故意标错的。
 * - practice：练习测试。判错的条目连正确标签一起给学生看，用来找线索。
 * - final：最后考。只给分数，句子永远不下发（达标看它）。
 */
export const MODEL_TRAINING_SPLITS = ['train', 'practice', 'final'] as const
export type ModelTrainingSplit = (typeof MODEL_TRAINING_SPLITS)[number]

export const MODEL_TRAINING_MIN_LABELS = 2
export const MODEL_TRAINING_MAX_LABELS = 6
export const MODEL_TRAINING_MAX_LABEL_LENGTH = 10
/** 一节三份加起来最多这么多条 */
export const MODEL_TRAINING_MAX_ITEMS = 2000
export const MODEL_TRAINING_MAX_TEXT = 200
/** 学生最多补这么多条（设计文档第 2 节第 8 条，定死） */
export const MODEL_TRAINING_MAX_ADDED = 30
export const MODEL_TRAINING_MAX_ADDED_TEXT = 100

// ---------------------------------------------------------------- 模型：朴素贝叶斯（前后端共用）

/** 认哪些字：字母、数字、汉字；标点空白跳过 */
const WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * 一句话拆成特征：每个字 + 相邻两个字（中间隔着标点的不算）。返回特征和它在句子里从第几个字开始
 * （按 Array.from 数），给「哪几个字让它判错」上色用。
 */
export function textFeatures(text: string): { feature: string; start: number; length: number }[] {
  const chars = Array.from(text.toLowerCase())
  const out: { feature: string; start: number; length: number }[] = []
  chars.forEach((ch, i) => {
    if (!WORD_CHAR.test(ch)) return
    out.push({ feature: ch, start: i, length: 1 })
    const next = chars[i + 1]
    if (next !== undefined && WORD_CHAR.test(next)) out.push({ feature: ch + next, start: i, length: 2 })
  })
  return out
}

export interface TrainingModel {
  labels: string[]
  /** 每类的先验（取对数）。一边倒的数据在这里起作用：拿不准时猜多的那边 */
  logPrior: number[]
  /** 特征 → 每类出现的概率（取对数，加一平滑） */
  logProb: Map<string, number[]>
}

/** 训练：数每类各有几条、每个特征在每类里出现几次。几百条只要几毫秒 */
export function trainModel(labels: string[], rows: { text: string; label: string }[]): TrainingModel {
  const k = labels.length
  const docs = Array.from({ length: k }, () => 0)
  const counts = new Map<string, number[]>()
  const totals = Array.from({ length: k }, () => 0)
  for (const row of rows) {
    const c = labels.indexOf(row.label)
    if (c < 0) continue
    docs[c]!++
    for (const { feature } of textFeatures(row.text)) {
      let arr = counts.get(feature)
      if (!arr) counts.set(feature, (arr = Array.from({ length: k }, () => 0)))
      arr[c]!++
      totals[c]!++
    }
  }
  const docTotal = docs.reduce((a, b) => a + b, 0)
  const vocab = counts.size
  const logPrior = docs.map((d) => Math.log((d + 1) / (docTotal + k)))
  const logProb = new Map<string, number[]>()
  for (const [feature, arr] of counts) {
    logProb.set(
      feature,
      arr.map((n, c) => Math.log((n + 1) / (totals[c]! + vocab))),
    )
  }
  return { labels, logPrior, logProb }
}

/** 判一句：每类的得分 = 先验 + 各特征的概率；没见过的特征不算。同分取标签顺序靠前的 */
export function predictLabel(model: TrainingModel, text: string): string {
  const scores = [...model.logPrior]
  for (const { feature } of textFeatures(text)) {
    const p = model.logProb.get(feature)
    if (p) p.forEach((v, c) => (scores[c]! += v))
  }
  let best = 0
  scores.forEach((s, c) => {
    if (s > scores[best]!) best = c
  })
  return model.labels[best]!
}

/** 判一份测试，回判对的条数 */
export function countCorrect(model: TrainingModel, rows: { text: string; answer: string }[]) {
  return rows.filter((row) => predictLabel(model, row.text) === row.answer).length
}

/**
 * 「为什么判错」：每个特征把结果往「判成的那类」推了多少（相对正确的那类）。
 * - weights：每个字一个数（按 Array.from），正的越大越红；两个字的特征平分给这两个字。
 * - keywords：推得最狠的几个（最多 3 个），已经挑了「难吃」就不再挑「难」「吃」。
 */
export function explainWrong(model: TrainingModel, text: string, predicted: string, expected: string) {
  const p = model.labels.indexOf(predicted)
  const e = model.labels.indexOf(expected)
  const weights = Array.from({ length: Array.from(text).length }, () => 0)
  const push = new Map<string, number>()
  for (const { feature, start, length } of textFeatures(text)) {
    const prob = model.logProb.get(feature)
    if (!prob || p < 0 || e < 0) continue
    const d = prob[p]! - prob[e]!
    for (let i = 0; i < length; i++) weights[start + i]! += d / length
    if (d > 0) push.set(feature, d)
  }
  const keywords: string[] = []
  for (const [feature] of [...push].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)) {
    if (keywords.length >= 3) break
    if (keywords.some((k) => k.includes(feature) || feature.includes(k))) continue
    keywords.push(feature)
  }
  return { weights: weights.map((w) => Math.round(w * 100) / 100), keywords }
}

/** 准确率按整数百分比显示，往下取：84.6% 显示 84%，免得显示 85% 却没达标 */
export function accuracyPercent(correct: number, total: number) {
  return total ? Math.floor((correct * 100) / total) : 0
}

export function reachesLine(correct: number, total: number, threshold: number) {
  return total > 0 && correct * 100 >= threshold * total
}

// ---------------------------------------------------------------- 学生的改动

/**
 * 学生改了什么：存改动不存整份（设计文档第 7 节）。改标签、删掉的按训练数据条目 id 记；
 * 补的条目带一个页面上自己编的 key，好改它的标签、删掉它。
 * 老师后来删了的条目，改动里对应的那几条直接不算。
 */
export const modelTrainingEditsSchema = z.object({
  relabels: z
    .array(z.object({ id: z.number().int().positive(), label: z.string() }))
    .max(MODEL_TRAINING_MAX_ITEMS)
    .default([]),
  removed: z.array(z.number().int().positive()).max(MODEL_TRAINING_MAX_ITEMS).default([]),
  added: z
    .array(
      z.object({
        key: z.number().int().nonnegative(),
        text: z.string().trim().min(1).max(MODEL_TRAINING_MAX_ADDED_TEXT),
        label: z.string(),
      }),
    )
    .max(MODEL_TRAINING_MAX_ADDED)
    .default([]),
})

export type ModelTrainingEdits = z.infer<typeof modelTrainingEditsSchema>

export const EMPTY_MODEL_TRAINING_EDITS: ModelTrainingEdits = { relabels: [], removed: [], added: [] }

/** 套上改动后的训练数据（顺序：原来的在前，补的在后） */
export function applyEdits(train: { id: number; text: string; label: string }[], edits: ModelTrainingEdits) {
  const relabel = new Map(edits.relabels.map((r) => [r.id, r.label]))
  const removed = new Set(edits.removed)
  return [
    ...train.filter((row) => !removed.has(row.id)).map((row) => ({ text: row.text, label: relabel.get(row.id) ?? row.label })),
    ...edits.added.map((row) => ({ text: row.text, label: row.label })),
  ]
}

/**
 * 两份改动差了几处（「改了 3 处，还没训练」）：改标签按条目比，删掉的、补的按有没有比。
 */
export function editsDiff(a: ModelTrainingEdits, b: ModelTrainingEdits) {
  let n = 0
  const ra = new Map(a.relabels.map((r) => [r.id, r.label]))
  const rb = new Map(b.relabels.map((r) => [r.id, r.label]))
  for (const id of new Set([...ra.keys(), ...rb.keys()])) if (ra.get(id) !== rb.get(id)) n++
  const da = new Set(a.removed)
  const db = new Set(b.removed)
  for (const id of new Set([...da, ...db])) if (da.has(id) !== db.has(id)) n++
  const aa = new Map(a.added.map((x) => [x.key, `${x.label}\n${x.text}`]))
  const ab = new Map(b.added.map((x) => [x.key, `${x.label}\n${x.text}`]))
  for (const key of new Set([...aa.keys(), ...ab.keys()])) if (aa.get(key) !== ab.get(key)) n++
  return n
}

// ---------------------------------------------------------------- 后台

const label = z.string().trim().min(1).max(MODEL_TRAINING_MAX_LABEL_LENGTH)

export const createModelTrainingRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
})

export const reorderModelTrainingsRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
})

/**
 * 一条数据。shown 只有训练数据有（测试的两份是 null）；answer 三份都有。
 * 语义上的要求（标签在标签集里、三份都有、达标线够得着…）不挂在 zod 上，见 api 的 modelTrainingSaveError()。
 */
export const modelTrainingItemInputSchema = z.object({
  id: z.number().int().positive().optional(),
  split: z.enum(MODEL_TRAINING_SPLITS),
  text: z.string().max(MODEL_TRAINING_MAX_TEXT),
  shown: z.string().nullable(),
  answer: z.string(),
})

export const saveModelTrainingRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  description: z.string().max(5000),
  /** 达标后给学生看的一段话（说那些系统认不出来的毛病） */
  review: z.string().max(2000),
  isPublic: z.boolean(),
  labels: z.array(label).max(MODEL_TRAINING_MAX_LABELS),
  /** 达标线，百分比 */
  threshold: z.number().int().min(1).max(100),
  items: z.array(modelTrainingItemInputSchema).max(MODEL_TRAINING_MAX_ITEMS),
})

export const adminModelTrainingItemSchema = z.object({
  id: z.number().int(),
  split: z.enum(MODEL_TRAINING_SPLITS),
  text: z.string(),
  shown: z.string().nullable(),
  answer: z.string(),
})

export const adminModelTrainingSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  review: z.string(),
  isPublic: z.boolean(),
  labels: z.array(z.string()),
  threshold: z.number().int(),
  items: z.array(adminModelTrainingItemSchema),
  createdBy: sampleUserSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminModelTrainingListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  isPublic: z.boolean(),
  trainCount: z.number().int(),
  practiceCount: z.number().int(),
  finalCount: z.number().int(),
  /** 训练过的学生数 */
  students: z.number().int(),
  createdBy: sampleUserSchema,
  updatedAt: z.string(),
})

// ---------------------------------------------------------------- 学生这边

export const modelTrainingListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  isPublic: z.boolean(),
  threshold: z.number().int(),
  /** 当前学生最后考的最高分（百分比）；没训练过 / 没登录是 null */
  best: z.number().int().nullable(),
  passed: z.boolean(),
})

/** 训练数据的一条，带「给学生的标签」（不带正确标签） */
export const modelTrainingTrainRowSchema = z.object({
  id: z.number().int(),
  text: z.string(),
  label: z.string(),
})

/** 练习测试里判错的一条：正确标签、判成了什么、每个字推了多少、推得最狠的几个词 */
export const modelTrainingWrongSchema = z.object({
  text: z.string(),
  answer: z.string(),
  predicted: z.string(),
  weights: z.array(z.number()),
  keywords: z.array(z.string()),
})

export const modelTrainingRunSchema = z.object({
  practice: z.number().int(),
  final: z.number().int(),
  passed: z.boolean(),
})

/** 达标后的复盘：老师埋的标错的，改对了几条、没找到的、改坏的 + 老师的说明 */
export const modelTrainingReviewSchema = z.object({
  mislabeled: z.number().int(),
  fixed: z.number().int(),
  missed: z.array(z.object({ id: z.number().int(), text: z.string(), shown: z.string(), answer: z.string() })),
  broken: z.array(z.object({ id: z.number().int(), text: z.string(), answer: z.string(), now: z.string() })),
  note: z.string(),
})

export const modelTrainingDetailSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  labels: z.array(z.string()),
  threshold: z.number().int(),
  isPublic: z.boolean(),
  /** 老师等非学生角色：能「重来」 */
  canReset: z.boolean(),
  train: z.array(modelTrainingTrainRowSchema),
  practiceTotal: z.number().int(),
  edits: modelTrainingEditsSchema,
  /** 上一次训练时的改动；没训练过是 null */
  trainedEdits: modelTrainingEditsSchema.nullable(),
  /** 每次训练的准确率（百分比），从早到晚 */
  runs: z.array(modelTrainingRunSchema),
  /** 上一次训练后练习测试判错的；没训练过是 null */
  practiceWrong: z.array(modelTrainingWrongSchema).nullable(),
  passed: z.boolean(),
  /** 达标了才有 */
  review: modelTrainingReviewSchema.nullable(),
})

export const saveModelTrainingEditsRequestSchema = z.object({
  edits: modelTrainingEditsSchema,
})

// ---------------------------------------------------------------- 老师：全班情况

export const modelTrainingProgressSchema = z.object({
  className: z.string().nullable(),
  classes: z.array(z.string()),
  labels: z.array(z.string()),
  threshold: z.number().int(),
  /** 训练数据，带给学生的标签和正确标签 */
  items: z.array(z.object({ id: z.number().int(), text: z.string(), shown: z.string(), answer: z.string() })),
  students: z.array(
    z.object({
      id: z.number().int(),
      username: z.string(),
      className: z.string().nullable(),
      runs: z.number().int(),
      /** 最后考的最高分（百分比）；没训练过是 null */
      best: z.number().int().nullable(),
      passed: z.boolean(),
      relabels: z.array(z.object({ id: z.number().int(), label: z.string() })),
      removed: z.array(z.number().int()),
    }),
  ),
})

export type ModelTrainingItemInput = z.infer<typeof modelTrainingItemInputSchema>
export type SaveModelTrainingRequest = z.infer<typeof saveModelTrainingRequestSchema>
export type CreateModelTrainingRequest = z.infer<typeof createModelTrainingRequestSchema>
export type ReorderModelTrainingsRequest = z.infer<typeof reorderModelTrainingsRequestSchema>
export type AdminModelTrainingItem = z.infer<typeof adminModelTrainingItemSchema>
export type AdminModelTraining = z.infer<typeof adminModelTrainingSchema>
export type AdminModelTrainingListItem = z.infer<typeof adminModelTrainingListItemSchema>
export type ModelTrainingListItem = z.infer<typeof modelTrainingListItemSchema>
export type ModelTrainingTrainRow = z.infer<typeof modelTrainingTrainRowSchema>
export type ModelTrainingWrong = z.infer<typeof modelTrainingWrongSchema>
export type ModelTrainingRun = z.infer<typeof modelTrainingRunSchema>
export type ModelTrainingReview = z.infer<typeof modelTrainingReviewSchema>
export type ModelTrainingDetail = z.infer<typeof modelTrainingDetailSchema>
export type SaveModelTrainingEditsRequest = z.infer<typeof saveModelTrainingEditsRequestSchema>
export type ModelTrainingProgress = z.infer<typeof modelTrainingProgressSchema>
