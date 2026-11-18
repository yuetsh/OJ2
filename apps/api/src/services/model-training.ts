/**
 * 「训练模型」：出题的语义校验、学生改动的校验、训练一次。设计见 docs/specs/2026-11-17-model-training-lab-design.md。
 *
 * **训练和判分只在服务器做**：最后考的句子不能发到浏览器（开发者工具一看就漏了），所以学生点「训练」就是
 * 把改动交上来，服务器用契约里的朴素贝叶斯训练、跑两份测试。几百条是毫秒级，不用新镜像。
 */
import {
  MODEL_TRAINING_MAX_LABELS,
  MODEL_TRAINING_MIN_LABELS,
  accuracyPercent,
  applyEdits,
  countCorrect,
  explainWrong,
  predictLabel,
  reachesLine,
  trainModel,
  type ModelTrainingEdits,
  type ModelTrainingReview,
  type ModelTrainingWrong,
  type SaveModelTrainingRequest,
} from '@oj2/contract'
import { asc, eq } from 'drizzle-orm'

import { db, schema } from '../db'

export type ItemRow = typeof schema.modelTrainingItem.$inferSelect

export function selectItems(modelTrainingId: number) {
  return db
    .select()
    .from(schema.modelTrainingItem)
    .where(eq(schema.modelTrainingItem.modelTrainingId, modelTrainingId))
    .orderBy(asc(schema.modelTrainingItem.order), asc(schema.modelTrainingItem.id))
}

/** 三份拆开；训练数据的「给学生的标签」是 shown（存的时候保证训练数据一定有） */
export function splitItems(items: ItemRow[]) {
  return {
    train: items.filter((i) => i.split === 'train').map((i) => ({ id: i.id, text: i.text, label: i.shown ?? i.answer, answer: i.answer })),
    practice: items.filter((i) => i.split === 'practice').map((i) => ({ text: i.text, answer: i.answer })),
    final: items.filter((i) => i.split === 'final').map((i) => ({ text: i.text, answer: i.answer })),
  }
}

/** 全改对、不补数据训练出来，最后考能到多少（出题页的「上限」，公开前要求达标线不高于它） */
export function ceilingPercent(labels: string[], items: { split: string; text: string; answer: string }[]) {
  const model = trainModel(
    labels,
    items.filter((i) => i.split === 'train').map((i) => ({ text: i.text, label: i.answer })),
  )
  const final = items.filter((i) => i.split === 'final')
  return accuracyPercent(countCorrect(model, final), final.length)
}

/** 整节存之前的检查，返回中文的、指到第几条的说法 */
export function modelTrainingSaveError(body: SaveModelTrainingRequest) {
  const labels = body.labels
  if (labels.length < MODEL_TRAINING_MIN_LABELS || labels.length > MODEL_TRAINING_MAX_LABELS) {
    return `标签要 ${MODEL_TRAINING_MIN_LABELS} 到 ${MODEL_TRAINING_MAX_LABELS} 个`
  }
  if (new Set(labels).size !== labels.length) return '标签有重复的'
  for (const [index, item] of body.items.entries()) {
    const where = `第 ${index + 1} 条`
    if (!item.text.trim()) return `${where}是空的`
    if (!labels.includes(item.answer)) return `${where}的正确标签「${item.answer}」不在这一节的标签里`
    if (item.split === 'train' && (item.shown === null || !labels.includes(item.shown))) {
      return `${where}是训练数据，要填给学生的标签`
    }
  }
  if (body.isPublic) {
    const count = (split: string) => body.items.filter((i) => i.split === split).length
    if (!count('train') || !count('practice') || !count('final')) return '训练、练习测试、最后考三份都要有数据，才能让学生看到'
    const ceiling = ceilingPercent(labels, body.items)
    if (body.threshold > ceiling) return `全改对也只能到 ${ceiling}%，达标线 ${body.threshold}% 没人够得着，调低一点再公开`
  }
  return null
}

/** 学生交上来的改动：条目得是这一节的训练数据、标签得是这一节的；去重。不对回中文说法 */
export function editsError(edits: ModelTrainingEdits, labels: string[], trainIds: Set<number>) {
  for (const r of edits.relabels) {
    if (!trainIds.has(r.id)) return '有一条训练数据已经被老师删掉了，刷新一下'
    if (!labels.includes(r.label)) return `没有「${r.label}」这个标签`
  }
  for (const id of edits.removed) if (!trainIds.has(id)) return '有一条训练数据已经被老师删掉了，刷新一下'
  for (const a of edits.added) if (!labels.includes(a.label)) return `没有「${a.label}」这个标签`
  if (new Set(edits.added.map((a) => a.key)).size !== edits.added.length) return '补的条目编号重复了，刷新一下'
  return null
}

/** 老师后来删了的条目，改动里对应的那几条不算；同一条只留最后一次改的标签 */
export function cleanEdits(edits: ModelTrainingEdits, trainIds: Set<number>): ModelTrainingEdits {
  const relabels = new Map<number, string>()
  for (const r of edits.relabels) if (trainIds.has(r.id)) relabels.set(r.id, r.label)
  return {
    relabels: [...relabels].map(([id, label]) => ({ id, label })),
    removed: [...new Set(edits.removed.filter((id) => trainIds.has(id)))],
    added: edits.added,
  }
}

type Split = ReturnType<typeof splitItems>

/** 用这份改动训练一次：两份测试各判对几条 + 练习测试判错的那几条（带「为什么」） */
export function runTraining(labels: string[], data: Split, edits: ModelTrainingEdits) {
  const model = trainModel(labels, applyEdits(data.train, edits))
  const practiceWrong: ModelTrainingWrong[] = []
  for (const row of data.practice) {
    const predicted = predictLabel(model, row.text)
    if (predicted !== row.answer) practiceWrong.push({ text: row.text, answer: row.answer, predicted, ...explainWrong(model, row.text, predicted, row.answer) })
  }
  return {
    practiceCorrect: data.practice.length - practiceWrong.length,
    practiceWrong,
    finalCorrect: countCorrect(model, data.final),
  }
}

export function passes(finalCorrect: number, finalTotal: number, threshold: number) {
  return reachesLine(finalCorrect, finalTotal, threshold)
}

/**
 * 达标后的复盘，对照学生**现在**的改动算：
 * - 标错的（shown ≠ answer）：改成了正确标签、或者删掉了，都算找到了；
 * - 改坏的：原本标对，被改成了别的标签（删掉好数据不算改坏）。
 */
export function buildReview(train: Split['train'], edits: ModelTrainingEdits, note: string): ModelTrainingReview {
  const relabel = new Map(edits.relabels.map((r) => [r.id, r.label]))
  const removed = new Set(edits.removed)
  const mislabeled = train.filter((row) => row.label !== row.answer)
  const missed = mislabeled.filter((row) => !removed.has(row.id) && relabel.get(row.id) !== row.answer)
  const broken = train.filter((row) => row.label === row.answer && !removed.has(row.id) && relabel.has(row.id) && relabel.get(row.id) !== row.answer)
  return {
    mislabeled: mislabeled.length,
    fixed: mislabeled.length - missed.length,
    missed: missed.map((row) => ({ id: row.id, text: row.text, shown: row.label, answer: row.answer })),
    broken: broken.map((row) => ({ id: row.id, text: row.text, answer: row.answer, now: relabel.get(row.id)! })),
    note,
  }
}
