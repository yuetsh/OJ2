import type { ModelTrainingSplit } from '@oj2/contract'

/**
 * 出题页的批量粘贴（设计文档第 5 节）。每行一条：`句子 ⇥ 给学生的标签 ⇥ 正确标签 ⇥ 用在哪`。
 * - 用在哪：训练 / 练习 / 考试（也认「练习测试」「最后考」），不写当训练；
 * - 训练数据「给学生的标签」不写就和正确标签一样（不是故意标错的）；两份测试只看正确标签。
 * 分隔符同时认 Tab、`|`、全角 `｜`：老师多半在 Excel / WPS 里整理好再复制，粘过来是 Tab。
 * 不对的行逐行报出来，对的照加。
 */
export interface PastedItem {
  split: ModelTrainingSplit
  text: string
  shown: string | null
  answer: string
}

const SPLITS: Record<string, ModelTrainingSplit> = {
  '': 'train',
  训练: 'train',
  练习: 'practice',
  练习测试: 'practice',
  考试: 'final',
  最后考: 'final',
}

export function parsePaste(source: string, labels: string[]) {
  const items: PastedItem[] = []
  const errors: string[] = []
  source.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return
    const where = `第 ${index + 1} 行`
    const parts = (line.includes('\t') ? line.split('\t') : line.split(/[|｜]/)).map((p) => p.trim())
    const [text = '', shownRaw = '', answer = '', splitRaw = ''] = parts
    const split = SPLITS[splitRaw]
    if (!text) return errors.push(`${where}没有句子`)
    if (!split) return errors.push(`${where}的「${splitRaw}」认不出来，写训练、练习或考试`)
    if (!labels.includes(answer)) return errors.push(answer ? `${where}的正确标签「${answer}」不是这节的标签` : `${where}没写正确标签`)
    if (split === 'train' && shownRaw && !labels.includes(shownRaw)) return errors.push(`${where}的「${shownRaw}」不是这节的标签`)
    items.push({ split, text, shown: split === 'train' ? shownRaw || answer : null, answer })
  })
  return { items, errors }
}
