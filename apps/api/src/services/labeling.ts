/**
 * 「数据标注」：出题的语义校验、判一条对不对。设计见 docs/specs/2026-11-17-data-labeling-lab-design.md。
 * 判对错只在这里（服务器）做，学生页面上拿不到答案。
 */
import {
  LABELING_MAX_LABELS,
  LABELING_MAX_SPAN_TEXT,
  LABELING_MIN_LABELS,
  sortSpans,
  spanFeedback,
  spanMistakes,
  spansEqual,
  type LabelingKind,
  type LabelingSpan,
  type SaveLabelingRequest,
} from '@oj2/contract'

import { schema } from '../db'

/** 不带图片（bytea）的条目列，列表、详情、进度都用它 */
export const itemColumns = {
  id: schema.labelingItem.id,
  labelingId: schema.labelingItem.labelingId,
  order: schema.labelingItem.order,
  text: schema.labelingItem.text,
  imageType: schema.labelingItem.imageType,
  answer: schema.labelingItem.answer,
  spans: schema.labelingItem.spans,
  reason: schema.labelingItem.reason,
}

export interface ItemRow {
  id: number
  text: string
  imageType: string | null
  answer: string | null
  spans: LabelingSpan[]
  reason: string
}

export function spansError(text: string, spans: LabelingSpan[], labels: string[], where: string) {
  const length = Array.from(text).length
  let lastEnd = 0
  for (const span of sortSpans(spans)) {
    if (span.start < 0 || span.end > length || span.start >= span.end) return `${where}有一段标的位置不对，重新标一下`
    if (!labels.includes(span.label)) return `${where}用了「${span.label}」，可这一节没有这个类别`
    if (span.start < lastEnd) return `${where}有两段重叠了`
    lastEnd = span.end
  }
  return null
}

/**
 * 整节存之前的检查，返回中文的、指到第几条的说法。`imageIds`：这一节现有的图片条目
 * （图片条目只能改，不能凭空建）。
 */
export function labelingSaveError(kind: LabelingKind, body: SaveLabelingRequest, imageIds: Set<number>) {
  const labels = body.labels
  if (labels.length < LABELING_MIN_LABELS || labels.length > LABELING_MAX_LABELS) {
    return `${kind === 'span' ? '类别' : '标签'}要 ${LABELING_MIN_LABELS} 到 ${LABELING_MAX_LABELS} 个`
  }
  if (new Set(labels).size !== labels.length) return `${kind === 'span' ? '类别' : '标签'}有重复的`
  for (const [index, item] of body.items.entries()) {
    const where = `第 ${index + 1} 条`
    if (kind === 'image') {
      if (item.id === undefined || !imageIds.has(item.id)) return `${where}的图片找不到了，刷新一下`
    } else if (!item.text.trim()) {
      return `${where}是空的`
    }
    if (kind === 'span') {
      if (Array.from(item.text).length > LABELING_MAX_SPAN_TEXT) return `${where}太长了，一句最多 ${LABELING_MAX_SPAN_TEXT} 个字`
      const error = spansError(item.text, item.spans, labels, where)
      if (error) return error
    } else {
      if (item.answer !== null && !labels.includes(item.answer)) return `${where}的标签「${item.answer}」不在这一节的标签里`
      if (body.isPublic && item.answer === null) return `${where}还没选标签，选好才能让学生看到`
    }
  }
  if (body.isPublic && !body.items.length) return '还没有数据，加了才能让学生看到'
  return null
}

/** 第一次交的对不对，对照**当前**答案现算（老师改了答案就跟着变） */
export function firstCorrect(
  kind: LabelingKind,
  item: Pick<ItemRow, 'answer' | 'spans'>,
  first: { firstLabel: string | null; firstSpans: LabelingSpan[] | null },
) {
  if (kind === 'span') return first.firstSpans !== null && spansEqual(item.spans, first.firstSpans)
  return first.firstLabel !== null && first.firstLabel === item.answer
}

/** 判一次：分类比标签，实体标注比每一段 */
export function judge(kind: LabelingKind, item: Pick<ItemRow, 'answer' | 'spans'>, given: { label?: string; spans?: LabelingSpan[] }) {
  if (kind === 'span') {
    const spans = given.spans ?? []
    const mistakes = spanMistakes(item.spans, spans)
    return { correct: mistakes.length === 0, feedback: mistakes.length ? `不对：${spanFeedback(mistakes)}` : null }
  }
  const correct = given.label === item.answer
  return { correct, feedback: correct ? null : '不对，再看看' }
}

/** 图片按文件头认的扩展名 → content-type */
export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}
