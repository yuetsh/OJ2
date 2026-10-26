import { isLessonDone, type TutorialProgress, type TutorialSummary } from '@oj2/contract'

export type TutorialType = 'python' | 'c'

export const COURSES: { type: TutorialType; label: string }[] = [
  { type: 'python', label: 'Python' },
  { type: 'c', label: 'C 语言' },
]

/**
 * 标题是「情境——知识点」（「蜜橘园环境预警——条件语句基础」）。学生找的是知识点，
 * 所以显示时知识点在前、情境在后。没有「——」的老教程整个当知识点。
 */
export function splitTitle(title: string) {
  const at = title.indexOf('——')
  if (at < 0) return { kp: title.trim(), scene: '' }
  return { kp: title.slice(at + 2).trim(), scene: title.slice(0, at).trim() }
}

/** 编辑时拆开的两半拼回去 */
export function joinTitle(kp: string, scene: string) {
  return scene.trim() ? `${scene.trim()}——${kp.trim()}` : kp.trim()
}

export interface ProjectGroup {
  /** 原样的项目名，「项目三 · 智慧农业·蜜橘园」；没填是空串 */
  project: string
  /** 「项目三」，没有这一截时是空串 */
  no: string
  /** 「智慧农业·蜜橘园」 */
  name: string
  icon: string
  tone: 'blue' | 'purple' | 'green' | 'orange' | 'gray'
  /** 这个项目里的课，`step` 是在整门课里的序号（1 起） */
  lessons: { id: number; title: string; step: number }[]
}

/** 「项目三 · 智慧农业·蜜橘园」拆成「项目三」和「智慧农业·蜜橘园」 */
export function splitProject(project: string) {
  const match = project.match(/^(项目[一二三四五六七八九十\d]+)\s*[·・.]\s*(.+)$/)
  if (!match) return { no: '', name: project || '其他' }
  return { no: match[1]!, name: match[2]!.trim() }
}

/** 项目图标按情境挑，认不出的给一本书 */
function projectLook(name: string): Pick<ProjectGroup, 'icon' | 'tone'> {
  if (name.includes('家居')) return { icon: 'ph:house', tone: 'blue' }
  if (name.includes('工业') || name.includes('设备')) return { icon: 'ph:factory', tone: 'purple' }
  if (name.includes('农业')) return { icon: 'ph:plant', tone: 'green' }
  if (name.includes('交通')) return { icon: 'ph:car', tone: 'orange' }
  return { icon: 'ph:book-open', tone: 'gray' }
}

/** 按项目分组，保持课程原来的顺序；同一个项目被别的项目隔开时各算一组 */
export function groupByProject(titles: TutorialSummary[]): ProjectGroup[] {
  const groups: ProjectGroup[] = []
  titles.forEach((item, index) => {
    const last = groups[groups.length - 1]
    if (last && last.project === item.project) {
      last.lessons.push({ id: item.id, title: item.title, step: index + 1 })
      return
    }
    const { no, name } = splitProject(item.project)
    groups.push({
      project: item.project,
      no,
      name,
      ...projectLook(name),
      lessons: [{ id: item.id, title: item.title, step: index + 1 }],
    })
  })
  return groups
}

export type LessonState = 'done' | 'started' | 'todo'

/**
 * 目录上的三态。学完 = 练一练全对（契约的 `isLessonDone`）；打开过或者做过练一练但没
 * 全对是「在学」；别的是没开始。
 */
export function lessonState(progress: TutorialProgress | undefined): LessonState {
  if (!progress) return 'todo'
  if (isLessonDone(progress)) return 'done'
  if (progress.viewCount > 0 || progress.exerciseSolved > 0) return 'started'
  return 'todo'
}

/**
 * 「接着学」哪一课：最近打开的那课；它已经学完了，就往后找第一课没学完的。
 * 一课没打开过返回 null（首页换成「开始学」）。
 */
export function continueStep(titles: TutorialSummary[], progress: Record<number, TutorialProgress>) {
  let latest: TutorialProgress | null = null
  for (const item of titles) {
    const row = progress[item.id]
    if (row?.lastViewedAt && (!latest || row.lastViewedAt > latest.lastViewedAt!)) latest = row
  }
  if (!latest) return null
  const index = titles.findIndex((item) => item.id === latest!.tutorialId)
  if (index < 0) return null
  if (lessonState(latest) !== 'done') return index + 1
  for (let i = index + 1; i < titles.length; i++) {
    if (lessonState(progress[titles[i]!.id]) !== 'done') return i + 1
  }
  return index + 1
}

export function doneCount(titles: TutorialSummary[], progress: Record<number, TutorialProgress>) {
  return titles.filter((item) => lessonState(progress[item.id]) === 'done').length
}

export function lessonPath(type: TutorialType, step: number) {
  return `/learn/${type}/${step.toString().padStart(2, '0')}`
}
