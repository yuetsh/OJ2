/**
 * 「数据标注」：出题的语义校验、判一条对不对。设计见 docs/specs/2026-11-17-data-labeling-lab-design.md。
 * 判对错只在这里（服务器）做，学生页面上拿不到答案。
 */
import {
  boxFeedback,
  boxMistakes,
  LABELING_MAX_LABELS,
  LABELING_MAX_SPAN_TEXT,
  LABELING_MIN_LABELS,
  sortSpans,
  spanFeedback,
  spanMistakes,
  spansEqual,
  type LabelingBox,
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
  boxes: schema.labelingItem.boxes,
  reason: schema.labelingItem.reason,
}

export interface ItemRow {
  id: number
  text: string
  imageType: string | null
  answer: string | null
  spans: LabelingSpan[]
  boxes: LabelingBox[]
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

/** 框都在图里面、类别在这一节的类别里（框之间可以重叠：人骑在车上） */
export function boxesError(boxes: LabelingBox[], labels: string[], where: string) {
  for (const box of boxes) {
    // 浮点误差：右下角算出来可能是 1.0000000002
    if (box.x + box.w > 1.000001 || box.y + box.h > 1.000001) return `${where}有一个框超出了图片，重新画一下`
    if (!labels.includes(box.label)) return `${where}用了「${box.label}」，可这一节没有这个类别`
  }
  return null
}

/**
 * 整节存之前的检查，返回中文的、指到第几条的说法。`imageIds`：这一节现有的图片条目
 * （图片条目只能改，不能凭空建）。
 */
function word(kind: LabelingKind) {
  return kind === 'span' || kind === 'box' ? '类别' : '标签'
}

export function labelingSaveError(kind: LabelingKind, body: SaveLabelingRequest, imageIds: Set<number>) {
  const labels = body.labels
  if (labels.length < LABELING_MIN_LABELS || labels.length > LABELING_MAX_LABELS) {
    return `${word(kind)}要 ${LABELING_MIN_LABELS} 到 ${LABELING_MAX_LABELS} 个`
  }
  if (new Set(labels).size !== labels.length) return `${word(kind)}有重复的`
  for (const [index, item] of body.items.entries()) {
    const where = `第 ${index + 1} 条`
    if (kind === 'image' || kind === 'box') {
      if (item.id === undefined || !imageIds.has(item.id)) return `${where}的图片找不到了，刷新一下`
    } else if (!item.text.trim()) {
      return `${where}是空的`
    }
    if (kind === 'span') {
      if (Array.from(item.text).length > LABELING_MAX_SPAN_TEXT) return `${where}太长了，一句最多 ${LABELING_MAX_SPAN_TEXT} 个字`
      const error = spansError(item.text, item.spans, labels, where)
      if (error) return error
    } else if (kind === 'box') {
      const error = boxesError(item.boxes, labels, where)
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
  item: Pick<ItemRow, 'answer' | 'spans' | 'boxes'>,
  first: { firstLabel: string | null; firstSpans: LabelingSpan[] | null; firstBoxes: LabelingBox[] | null },
) {
  if (kind === 'span') return first.firstSpans !== null && spansEqual(item.spans, first.firstSpans)
  if (kind === 'box') return first.firstBoxes !== null && boxMistakes(item.boxes, first.firstBoxes).length === 0
  return first.firstLabel !== null && first.firstLabel === item.answer
}

/** 判一次：分类比标签，实体标注比每一段，框选比每个框（重合够一半、类别一样） */
export function judge(
  kind: LabelingKind,
  item: Pick<ItemRow, 'answer' | 'spans' | 'boxes'>,
  given: { label?: string; spans?: LabelingSpan[]; boxes?: LabelingBox[] },
) {
  if (kind === 'box') {
    const mistakes = boxMistakes(item.boxes, given.boxes ?? [])
    return { correct: mistakes.length === 0, feedback: mistakes.length ? `不对：${boxFeedback(mistakes)}` : null }
  }
  if (kind === 'span') {
    const spans = given.spans ?? []
    const mistakes = spanMistakes(item.spans, spans)
    return { correct: mistakes.length === 0, feedback: mistakes.length ? `不对：${spanFeedback(mistakes)}` : null }
  }
  const correct = given.label === item.answer
  return { correct, feedback: correct ? null : '不对，再看看' }
}

/** 图片按文件头认的扩展名 → content-type */
/**
 * 从文件头读出图片的宽高（PNG / JPG / GIF / BMP，和 IMAGE_TYPES 同一批），读不出来回 null。
 * 出题页上传前在浏览器里缩到长边 1280，服务器原来只查 2MB：绕过页面直接调接口能塞进一张 4000px 的图，
 * 学生多在手机上看，一节十几张。只读头上几个字节，不解码。
 */
export function imageSize(buf: Uint8Array, extension: string): { width: number; height: number } | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  try {
    if (extension === '.png') return { width: view.getUint32(16), height: view.getUint32(20) }
    if (extension === '.gif') return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
    if (extension === '.bmp') {
      // 老的 BITMAPCOREHEADER（头长 12）宽高是 16 位，其余都是 32 位、高度可能为负（自上而下存）
      if (view.getUint32(14, true) === 12) return { width: view.getUint16(18, true), height: view.getUint16(20, true) }
      return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
    }
    if (extension === '.jpg') {
      // 一段一段往后跳，找到 SOFn（帧头）读宽高；C4 / C8 / CC 不是帧头
      let pos = 2
      while (pos + 9 < buf.length) {
        if (buf[pos] !== 0xff) return null
        const marker = buf[pos + 1]!
        if (marker === 0xff) {
          pos += 1 // 填充字节
          continue
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: view.getUint16(pos + 7), height: view.getUint16(pos + 5) }
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
          pos += 2 // 没有长度的独立标记
          continue
        }
        pos += 2 + view.getUint16(pos + 2)
      }
    }
  } catch {
    // 文件太短、读越界
  }
  return null
}

export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}
