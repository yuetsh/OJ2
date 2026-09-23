import { HINT_LEVEL_COMPILE } from "@oj2/contract"

import { completeChat } from "./ai"

/**
 * 提示的**输出后过滤**（AI 时代 OJ 设计 2.5 / 2.6）。
 *
 * 为什么不能只靠 prompt：「不要给代码」是软约束，模型忍不住的时候一次就把这一级的
 * 意义废掉了。为什么不能边流式边过滤：发现违规时内容已经在学生屏幕上了 —— 所以
 * **整段生成、过滤通过才推给前端**（逐字显示交给前端模拟）。
 *
 * 违规就重新生成，**只重一次**：再不过就发写死的兜底话术。两次都要留痕
 * （`ai_hint.filter_attempt` / `filter_blocked` / `filter_reason`），
 * 「输出过滤触发率」就是从这三列出来的。
 *
 * 判定刻意只用**客观、低误报**的信号 —— 误判一次的代价是白烧一次调用，
 * 而且学生等的时间翻倍：
 *
 * - 代码块（```）和过长的行内代码：L0～L3 一行代码都不许出现。
 * - **整行不含中文的类代码行**：把代码摊平成正文躲过围栏的那种写法。提示的正文是
 *   中文，一整行连一个汉字都没有还带着 `;` `=` `(`，基本只能是代码。
 * - 和标准答案的重合行数：防止换个说法把标程抄出来。
 * - L0 一句问句都没有：L0 的全部意义就是只反问，这条是可机检的最低要求。
 * - **L4 例外**：它本来就可以给「关键的一行」，所以上面三种代码形态不是一出现就拦，
 *   而是合起来算行数，超过 `KEY_LINES_MAX` 才拦 —— 否则一个代码块就能把整份答案带出去。
 *
 * 编译失败那一档（`HINT_LEVEL_COMPILE`）只跑标程重合这一条 —— 编译错误只关乎语法，
 * 给出定位甚至正确片段都不算放水（见契约里 HINT_LEVEL_COMPILE 的注释）。
 */

/** 行内代码超过这个长度就当代码片段，短的（`int`、`n`、`%d`、`a[i]`）是正常讲解 */
const INLINE_CODE_MAX = 24
/** 和标准答案重合到这么多行就算抄答案 */
const ANSWER_LINE_HITS = 3
/** 参与重合比对的行至少这么长，短行（`}`、`return 0;`）谁写都一样 */
const ANSWER_LINE_MIN = 12

const CJK = /[一-龥]/

/**
 * 阶梯上唯一允许出现代码的一级（L4 示例）。写死成 4，别拿 `HINT_MAX_LEVEL` 代 ——
 * 以后加了 L5，放开代码的那一级就跟着跑了。
 */
export const KEY_LINE_LEVEL = 4

/**
 * L4 最多能给几行代码。prompt 里对模型说的「最多两行」是同一个数（`hint-diagnosis.ts`
 * 的 `LEVEL_COMMON_KEY_LINE`），改一边就要改另一边。
 */
const KEY_LINES_MAX = 2

/** 兜底话术：两次都被拦时发它，`content` 存的就是这句，不是模型的输出 */
const FALLBACK: Record<number, string> = {
  [HINT_LEVEL_COMPILE]:
    "这次没能给出有效的提示。编译报错的第一行通常就写着出错的行号，先跳到那一行，再往上看一两行 —— 漏分号、括号不配对，报错点往往在真正出错的下一行。",
  0: "这次没能给出有效的提示。先别急着改代码，问自己三个问题：这题的输入一共有几个数？每一步我想算的是什么？我的程序在哪种情况下会算得不对？",
  1: "这次没能给出有效的提示。把你的代码分成「读入、计算、输出」三段，一段一段对着题目要求核一遍，先找出是哪一段没按题目说的做。",
  2: "这次没能给出有效的提示。想一想这道题主要用到哪个知识点，把教程里对应的那一节再看一遍，然后带着它回来读自己的代码。",
  3: "这次没能给出有效的提示。先不看代码，用中文把解题步骤一条一条写在纸上：读入什么、每一步算什么、最后输出什么。写完再对照你的程序，看是哪一步没有写出来。",
  4: "这次没能给出有效的提示。挑一组最简单的输入，拿纸笔把你的程序一行一行走一遍，记下每个变量的值，和你心里算出来的答案对照，第一个对不上的地方就是要改的那一行。",
}

function fallbackText(level: number) {
  return FALLBACK[level] ?? FALLBACK[0]!
}

/** 标准答案里值得比对的行（去掉空白，短行不算） */
function answerLines(code: string) {
  return code
    .split("\n")
    .map((line) => line.replace(/\s+/g, ""))
    .filter((line) => line.length >= ANSWER_LINE_MIN)
}

/** 整行不含中文、又带着代码标点的行，多半是摊平成正文的代码 */
function looksLikeCode(line: string) {
  const text = line.trim()
  if (text.length < 6 || CJK.test(text)) return false
  if (/^[-=*_#>|\s]+$/.test(text)) return false // Markdown 的分隔线、空列表项
  return /[;=]|\w\s*\(/.test(text)
}

/**
 * L4 的代码行数：代码块里的非空行 + 围栏外摊平的类代码行 + 过长的行内代码（一段算一行）。
 * 没闭合的围栏按一直开到结尾算，免得漏一个 ``` 就把后面的代码全放过去。
 */
function keyLineCount(text: string) {
  let count = 0
  let fenced = false
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      if (line.trim()) count++
      continue
    }
    if (looksLikeCode(line)) {
      count++
      continue
    }
    const inline = line.match(/`([^`\n]+)`/g) ?? []
    count += inline.filter((item) => item.length - 2 > INLINE_CODE_MAX).length
  }
  return count
}

/**
 * 这段内容违规了没有：返回违规原因，通过就是 null。
 * `referenceCode` 是标准答案，没有就跳过重合那一条。
 */
export function hintFilterReason(
  content: string,
  level: number,
  referenceCode: string | null,
): string | null {
  const text = content.trim()
  if (!text) return "空回复"
  if (level === KEY_LINE_LEVEL) {
    const lines = keyLineCount(text)
    if (lines > KEY_LINES_MAX)
      return `代码 ${lines} 行，超过 ${KEY_LINES_MAX} 行`
  } else if (level !== HINT_LEVEL_COMPILE) {
    if (/```/.test(text)) return "出现代码块"
    const inline = text.match(/`([^`\n]+)`/g) ?? []
    if (inline.some((item) => item.length - 2 > INLINE_CODE_MAX))
      return "行内代码过长"
    // 围栏里的代码已经被上面拦掉了，这里找的是摊平进正文的
    const bare = text.split("\n").filter(looksLikeCode)
    if (bare.length) return `正文里出现代码：${bare[0]!.trim().slice(0, 60)}`
    if (level === 0 && !/[?？]/.test(text)) return "L0 没有一句问句"
  }
  if (referenceCode) {
    const flat = text.replace(/\s+/g, "")
    const hits = new Set(
      answerLines(referenceCode).filter((line) => flat.includes(line)),
    )
    if (hits.size >= ANSWER_LINE_HITS) return `和标准答案重合 ${hits.size} 行`
  }
  return null
}

export interface FilteredHint {
  /** 真正发给学生的正文；两次都被拦时是兜底话术 */
  content: string
  /**
   * 一共生成了几次（1 = 一次就过，2 = 重生成过）。**不等于「发出去的是第几次生成」**：
   * `blocked` 为真时两次生成都作废了，发出去的是兜底话术。
   */
  attempt: number
  /** 两次都违规，发的是兜底话术 —— 这条提示等于没给，只是没让学生空手而归 */
  blocked: boolean
  /** 触发过的违规原因，两次都触发时用 `; ` 连起来。null = 一次都没触发 */
  reason: string | null
}

/**
 * 重生成时追加给模型的话，把上一次踩的线点名说清楚。
 *
 * **按档分叉**：编译失败那一档本来就允许给片段（见契约里 `HINT_LEVEL_COMPILE` 的注释），
 * 它唯一能触发重生成的是「和标准答案重合」—— 对它说「不要出现任何代码」等于用阶梯的
 * 标准把这一档的提示也一起砍了，学生拿到的反而更差。L4 同理，它的线是行数、不是有没有。
 */
function retrySystem(system: string, reason: string, level: number) {
  const demand =
    level === HINT_LEVEL_COMPILE
      ? "重写一遍，只讲怎么看报错、怎么定位到出错的那一行，不要把标准答案的内容搬进来。"
      : level === KEY_LINE_LEVEL
        ? `重写一遍，代码加起来最多 ${KEY_LINES_MAX} 行，只给最关键的那一处，其余用文字说明，不要给出整段代码。`
        : "重写一遍，务必守住上面的限制：不要出现任何代码或代码块，不要把代码摊平写在正文里。"
  return `${system}\n\n上一次的回答被判为违规（${reason}），已经作废。${demand}`
}

/**
 * 生成一条通过过滤的提示。
 *
 * 第一次调用抛错就往外抛（学生什么都没拿到，该走「AI 提示生成失败」那条路）；
 * **重生成**那次抛错则退回兜底话术 —— 手里已经有一段违规内容，让学生空手而归更糟。
 */
export async function generateFilteredHint(options: {
  system: string
  prompt: string
  level: number
  referenceCode: string | null
}): Promise<FilteredHint> {
  const { system, prompt, level, referenceCode } = options
  const first = (await completeChat(system, prompt)).trim()
  const firstReason = hintFilterReason(first, level, referenceCode)
  if (!firstReason)
    return { content: first, attempt: 1, blocked: false, reason: null }

  let second: string
  try {
    second = (
      await completeChat(retrySystem(system, firstReason, level), prompt)
    ).trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: fallbackText(level),
      attempt: 2,
      blocked: true,
      reason: `${firstReason}; 重生成失败：${message}`,
    }
  }
  const secondReason = hintFilterReason(second, level, referenceCode)
  if (!secondReason)
    return { content: second, attempt: 2, blocked: false, reason: firstReason }
  return {
    content: fallbackText(level),
    attempt: 2,
    blocked: true,
    reason: `${firstReason}; ${secondReason}`,
  }
}
