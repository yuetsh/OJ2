import type { Exercise } from "utils/types"

/**
 * 把一课的 Markdown 正文拆成几段，各段交给不同的组件渲染：
 *
 * - `heading`：二级标题单独拿出来，自己出 id —— 右边「这一课」的大纲靠它跳转、高亮；
 * - `goals`：「## 学习目标」那一节画成「学完这课你能」的方框；
 * - `code`：带语言的代码块（```python / ```c）换成能改、能运行的代码块；
 *   不带语言的（「输出结果」那种）留在 Markdown 里照常显示；
 * - `exercise`：`[[exercise:36]]` 占位符换成练一练；
 * - `md`：其余的交给 MdPreview。
 *
 * 正文开头的「# 标题」「**所属项目：…**」和紧跟着的项目配图不渲染：标题和项目页面上方
 * 已经有了，每课都重复一张同样的项目图只是把正文往下推。
 */
export type LessonSegment =
  | { type: "md"; content: string }
  | { type: "heading"; id: string; text: string }
  | { type: "goals"; id: string; items: string[] }
  | { type: "code"; lang: "python" | "c"; code: string; index: number }
  | { type: "exercise"; exercise: Exercise; index: number }

/** 大纲里的一项：一个二级标题，挂着它这一节里的练一练 */
export interface OutlineItem {
  id: string
  text: string
  exerciseIds: number[]
}

const CODE_LANGS: Record<string, "python" | "c"> = {
  python: "python",
  py: "python",
  python3: "python",
  c: "c",
  cpp: "c",
  "c++": "c",
}

const EXERCISE_RE = /\[\[exercise:(\d+)\]\]/g
const GOALS_TITLE = "学习目标"

/** 去掉开头的标题、所属项目、项目配图（中间的空行一起） */
function stripPreamble(lines: string[]) {
  let i = 0
  const skipBlank = () => {
    while (i < lines.length && !lines[i]!.trim()) i++
  }
  skipBlank()
  if (lines[i]?.startsWith("# ")) i++
  skipBlank()
  if (/^\*\*所属项目[：:]/.test(lines[i]?.trim() ?? "")) {
    i++
    skipBlank()
    if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(lines[i]?.trim() ?? "")) i++
  }
  return lines.slice(i)
}

export function parseLesson(content: string, exercises: Exercise[]) {
  const byId = new Map(exercises.map((item) => [item.id, item]))
  const segments: LessonSegment[] = []
  const outline: OutlineItem[] = []
  let md: string[] = []
  let codeIndex = 0
  let exerciseIndex = 0
  let headingIndex = 0

  const flush = () => {
    const text = md.join("\n")
    if (text.trim()) segments.push({ type: "md", content: text })
    md = []
  }

  const lines = stripPreamble(content.replace(/\r\n/g, "\n").split("\n"))
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const fence = line.match(/^(\s*)(```+|~~~+)\s*([\w+#-]*)\s*$/)
    if (fence) {
      const marker = fence[2]!
      const lang = CODE_LANGS[fence[3]!.toLowerCase()]
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !lines[j]!.trim().startsWith(marker)) body.push(lines[j++]!)
      if (lang) {
        flush()
        segments.push({ type: "code", lang, code: body.join("\n"), index: codeIndex++ })
      } else {
        md.push(line, ...body, lines[j] ?? marker)
      }
      i = j + 1
      continue
    }

    const heading = line.match(/^##\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flush()
      const text = heading[1]!.trim()
      const id = `section-${headingIndex++}`
      if (text === GOALS_TITLE) {
        // 学习目标：收到下一个分隔线或标题为止，只要列表项
        const items: string[] = []
        let j = i + 1
        while (j < lines.length && !/^(---+|##\s)/.test(lines[j]!.trim())) {
          const item = lines[j]!.match(/^\s*[-*+]\s+(.+)$/)
          if (item) items.push(item[1]!.trim())
          j++
        }
        segments.push({ type: "goals", id, items })
        outline.push({ id, text: "学完这课你能", exerciseIds: [] })
        i = j
        continue
      }
      segments.push({ type: "heading", id, text })
      outline.push({ id, text, exerciseIds: [] })
      i++
      continue
    }

    // 节与节之间的分隔线：二级标题本身就隔开了，再画一道线是重复
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      i++
      continue
    }

    if (EXERCISE_RE.test(line)) {
      EXERCISE_RE.lastIndex = 0
      let last = 0
      for (const match of line.matchAll(EXERCISE_RE)) {
        md.push(line.slice(last, match.index))
        last = match.index! + match[0].length
        const exercise = byId.get(Number(match[1]))
        if (!exercise) continue
        flush()
        segments.push({ type: "exercise", exercise, index: exerciseIndex++ })
        outline[outline.length - 1]?.exerciseIds.push(exercise.id)
      }
      md.push(line.slice(last))
      i++
      continue
    }

    md.push(line)
    i++
  }
  flush()

  // 正文里没放占位符的练一练接在最后：学完一课要全做对，看不见的题会让这课永远学不完
  const placed = new Set(
    segments.flatMap((item) => (item.type === "exercise" ? [item.exercise.id] : [])),
  )
  for (const exercise of exercises) {
    if (placed.has(exercise.id)) continue
    segments.push({ type: "exercise", exercise, index: exerciseIndex++ })
    outline[outline.length - 1]?.exerciseIds.push(exercise.id)
  }
  return { segments, outline, exerciseCount: exerciseIndex }
}
