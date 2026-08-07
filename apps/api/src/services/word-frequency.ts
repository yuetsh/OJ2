import { Jieba } from "@node-rs/jieba"
import { dict } from "@node-rs/jieba/dict"

/**
 * 流程图评语词云的分词。对齐旧后端 `flowchart/views/admin.py` 的
 * STOPWORDS / CUSTOM_WORDS / _build_word_frequencies 三段。
 *
 * 停用词表逐词照搬，改一个词就会让词云和旧后端对不上 —— 教师是拿它横向比不同班级的，
 * 词表变了历史截图就没法比。
 */
const STOPWORDS = new Set(
  (
    "的 了 是 在 和 有 就 不 也 都 要 会 这 那 到 说 上 为 与 及 等 " +
    "把 被 从 而 所 但 如 又 或 很 更 还 让 对 已 向 只 能 以 中 可以 " +
    "可能 需要 没有 使用 进行 注意 建议 应该 考虑 整体 基本 部分 " +
    "一个 一些 一下 一定 一种 这个 所有 其他 比较 存在 明确 " +
    "正确 良好 清晰 合理 较好 不错 符合 标准 "
  )
    .split(" ")
    .filter(Boolean),
)

const CUSTOM_WORDS = [
  "循环结构", "条件判断", "判断条件", "结束条件", "循环条件",
  "异常处理", "边界条件", "输入输出", "输入验证", "开始结束",
  "结束节点", "开始节点", "判断节点", "流程走向", "逻辑错误",
  "逻辑缺陷", "逻辑不清", "缺少分支", "缺少步骤", "缺少判断",
  "缺少循环", "死循环", "无限循环", "循环出口", "循环体",
  "条件分支", "分支结构", "分支不全", "分支缺失", "符号使用",
  "符号不规范", "连线混乱", "变量初始化", "赋值操作", "累加操作",
  "终止条件", "退出条件", "返回值",
]

/**
 * 词典加载有一次性开销（约 100ms），放在模块级会拖慢 API 冷启动，
 * 而词云只有教师偶尔点一次。改成首次调用时才建。
 */
let instance: Jieba | null = null

function jieba() {
  if (instance) return instance
  const built = Jieba.withDict(dict)
  // 对应旧后端的 jieba.add_word(w, freq=9999)。
  // @node-rs/jieba@2 没有导出 insertWord/addWord，改用用户词典缓冲区，格式为「词 词频」。
  built.loadDict(
    Buffer.from(CUSTOM_WORDS.map((word) => `${word} 9999`).join("\n") + "\n"),
  )
  instance = built
  return built
}

export function buildWordFrequencies(texts: string[], topN = 80) {
  const counter = new Map<string, number>()
  const cutter = jieba()
  for (const raw of texts) {
    const text = raw.replaceAll("【重点】", "")
    for (const token of cutter.cut(text)) {
      const word = token.trim()
      if (word.length < 2 || STOPWORDS.has(word)) continue
      counter.set(word, (counter.get(word) ?? 0) + 1)
    }
  }
  return [...counter]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}
