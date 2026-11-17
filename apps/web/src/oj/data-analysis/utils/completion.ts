import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { enhanceCompletion } from 'shared/extensions/autocompletion'

/**
 * 「数据分析」编辑器的补全（2026-11-12 用户要的）：题目页那套只有 Python 自带的函数，这里再补上
 * pandas / matplotlib / numpy / seaborn / jieba 课上真会用到的那些，外加素材表的列名。
 *
 * - `pd.`、`plt.` 这类点号后面只出那个库的，别让 print 之类混进来；
 * - 别的变量后面打点（df.、avg.、df['数学'].），没法知道它是什么类型，统一给表 / 一列的常用方法；
 * - `df['` 的引号里出素材表的列名 —— 数据课最常见的错就是列名写错、多个空格（KeyError）；
 * - 其余位置还是题目页那套，再加上 pd、plt 这些名字和三句常用的 import。
 *
 * 只挑课上用得到的，不求全；每项一句中文，和题目页的补全一个写法。
 */

type Item = { label: string; detail: string; info?: string; call?: string; property?: boolean }

/**
 * 函数项：插入 `名字()`，光标停在括号里（和题目页那套一样）。带了空引号 / 空方括号 / 空花括号的
 * （`read_excel('')`、`concat([])`、`rename(columns={})`），光标停在头一对空的中间，接着就能打文件名
 */
function cursorOffset(insert: string) {
  const empty = insert.search(/''|""|\[\]|\{\}|\(\)/)
  if (empty >= 0) return empty + 1
  const paren = insert.indexOf('(')
  return paren >= 0 ? paren + 1 : insert.length
}

function toCompletion(item: Item, boost = 0): Completion {
  if (item.property) return { label: item.label, detail: item.detail, info: item.info, type: 'property', boost }
  const insert = item.call ?? `${item.label}()`
  const cursor = cursorOffset(insert)
  return {
    label: item.label,
    detail: item.detail,
    info: item.info,
    type: 'function',
    boost,
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + cursor } })
    },
  }
}

const PD: Item[] = [
  { label: 'read_excel', detail: '读 Excel 表', info: "pd.read_excel('成绩.xlsx')，文件名要和素材里的一模一样", call: "read_excel('')" },
  { label: 'read_csv', detail: '读 CSV 表', info: "pd.read_csv('数据.csv')；乱码时加 encoding='gbk'", call: "read_csv('')" },
  { label: 'DataFrame', detail: '自己建一张表', info: "pd.DataFrame({'姓名': ['小明'], '分数': [90]})" },
  { label: 'Series', detail: '自己建一列数据' },
  { label: 'concat', detail: '把几张表上下拼起来', info: 'pd.concat([表1, 表2])', call: 'concat([])' },
  { label: 'merge', detail: '按某一列把两张表连起来', info: "pd.merge(表1, 表2, on='学号')" },
  { label: 'cut', detail: '把数字分成几段', info: "pd.cut(df['数学'], bins=[0, 60, 80, 100], labels=['不及格', '良', '优'])" },
  { label: 'to_numeric', detail: '把文字转成数字' },
  { label: 'to_datetime', detail: '把文字转成日期' },
]

const PLT: Item[] = [
  { label: 'bar', detail: '柱状图', info: 'plt.bar(横轴的名字, 柱子的高度)' },
  { label: 'barh', detail: '横着的柱状图' },
  { label: 'plot', detail: '折线图', info: 'plt.plot(横轴, 纵轴)' },
  { label: 'pie', detail: '饼图', info: "plt.pie(数值, labels=名字, autopct='%.1f%%')" },
  { label: 'scatter', detail: '散点图', info: 'plt.scatter(横轴, 纵轴)' },
  { label: 'hist', detail: '直方图（看分布）', info: "plt.hist(df['数学'], bins=10)" },
  { label: 'title', detail: '图的标题', call: "title('')" },
  { label: 'xlabel', detail: '横轴的文字', call: "xlabel('')" },
  { label: 'ylabel', detail: '纵轴的文字', call: "ylabel('')" },
  { label: 'legend', detail: '显示图例（每条线 / 每组柱子是什么）' },
  { label: 'xticks', detail: '横轴刻度', info: '名字太挤时：plt.xticks(rotation=45)', call: 'xticks(rotation=45)' },
  { label: 'yticks', detail: '纵轴刻度' },
  { label: 'ylim', detail: '纵轴的范围', info: 'plt.ylim(0, 100)' },
  { label: 'grid', detail: '加网格线' },
  { label: 'figure', detail: '新开一张图（可以定大小）', call: 'figure(figsize=(8, 4))' },
  { label: 'subplot', detail: '一张图里放几个小图', info: 'plt.subplot(1, 2, 1)：一行两个，画第一个' },
  { label: 'text', detail: '在图上写字' },
  { label: 'axhline', detail: '画一条横线（比如及格线）', info: "plt.axhline(60, color='red')" },
  { label: 'tight_layout', detail: '自动调整，别让文字挤在一起' },
  { label: 'show', detail: '显示图' },
]

const NP: Item[] = [
  { label: 'mean', detail: '平均数' },
  { label: 'median', detail: '中位数' },
  { label: 'sum', detail: '求和' },
  { label: 'max', detail: '最大值' },
  { label: 'min', detail: '最小值' },
  { label: 'std', detail: '标准差（分数差得开不开）' },
  { label: 'round', detail: '保留几位小数', info: 'np.round(数, 1)' },
  { label: 'sqrt', detail: '开平方' },
  { label: 'array', detail: '建一个数组', call: 'array([])' },
  { label: 'arange', detail: '一串等差的数', info: 'np.arange(0, 10, 2) → 0 2 4 6 8' },
  { label: 'linspace', detail: '在两个数之间均匀取几个点' },
  { label: 'sort', detail: '排序' },
]

const SNS: Item[] = [
  { label: 'barplot', detail: '柱状图（自动配色）', info: 'sns.barplot(x=..., y=...)' },
  { label: 'countplot', detail: '数一数每类有几个' },
  { label: 'histplot', detail: '直方图' },
  { label: 'boxplot', detail: '箱线图（看分布和异常值）' },
  { label: 'lineplot', detail: '折线图' },
  { label: 'scatterplot', detail: '散点图' },
  { label: 'heatmap', detail: '热力图', info: 'sns.heatmap(表, annot=True)' },
  { label: 'set_theme', detail: '换一套好看的样式' },
]

const JIEBA: Item[] = [
  { label: 'lcut', detail: '把一句中文切成词，得到列表', info: "jieba.lcut('我爱数据分析')" },
  { label: 'cut', detail: '切词（得到的不是列表，一般用 lcut）' },
  { label: 'add_word', detail: '告诉它某个词别切开', call: "add_word('')" },
]

/** 表（DataFrame）和一列（Series）的常用方法：别的变量后面打点时给这一组 */
const FRAME: Item[] = [
  { label: 'head', detail: '看前几行', info: 'df.head() 默认 5 行，df.head(10) 看 10 行' },
  { label: 'tail', detail: '看最后几行' },
  { label: 'describe', detail: '一次看平均、最大、最小……' },
  { label: 'info', detail: '看每一列是什么类型、有没有空的' },
  { label: 'mean', detail: '平均数' },
  { label: 'sum', detail: '求和' },
  { label: 'max', detail: '最大值' },
  { label: 'min', detail: '最小值' },
  { label: 'median', detail: '中位数' },
  { label: 'count', detail: '有几个（不算空的）' },
  { label: 'std', detail: '标准差' },
  { label: 'round', detail: '保留几位小数', call: 'round(1)' },
  { label: 'sort_values', detail: '按某一列排序', info: "df.sort_values('数学', ascending=False) 从大到小", call: "sort_values('')" },
  { label: 'groupby', detail: '分组再算', info: "df.groupby('班级')['数学'].mean()", call: "groupby('')" },
  { label: 'value_counts', detail: '每个值出现几次' },
  { label: 'unique', detail: '有哪些不同的值' },
  { label: 'nunique', detail: '有几种不同的值' },
  { label: 'idxmax', detail: '最大的那个在哪（行名 / 列名）' },
  { label: 'idxmin', detail: '最小的那个在哪' },
  { label: 'drop', detail: '删掉某几列 / 某几行', info: "df.drop(columns=['姓名'])", call: 'drop(columns=[])' },
  { label: 'dropna', detail: '删掉有空值的行' },
  { label: 'fillna', detail: '把空值填上', info: 'df.fillna(0)' },
  { label: 'isnull', detail: '哪些是空的' },
  { label: 'rename', detail: '改列名', info: "df.rename(columns={'旧名': '新名'})", call: 'rename(columns={})' },
  { label: 'astype', detail: '换类型', info: "df['分数'].astype(int)" },
  { label: 'apply', detail: '对每一个值做同一件事' },
  { label: 'reset_index', detail: '把行名变回 0、1、2…' },
  { label: 'set_index', detail: '用某一列当行名', call: "set_index('')" },
  { label: 'plot', detail: '直接画图', info: "avg.plot.bar() / df.plot(x='姓名', y='数学')" },
  { label: 'to_excel', detail: '存成 Excel', call: "to_excel('', index=False)" },
  { label: 'columns', detail: '有哪些列', property: true },
  { label: 'shape', detail: '几行几列', property: true },
  { label: 'index', detail: '行名', property: true },
  { label: 'values', detail: '只要里面的数', property: true },
  { label: 'dtypes', detail: '每一列的类型', property: true },
  { label: 'loc', detail: '按名字挑行和列', info: "df.loc[df['数学'] >= 90, ['姓名', '数学']]", property: true },
  { label: 'iloc', detail: '按位置挑行和列', info: 'df.iloc[0:5, 1:3]', property: true },
  { label: 'str', detail: '对一列文字做处理', info: "df['姓名'].str.startswith('王')", property: true },
]

/** `.plot.` 后面：pandas 直接画图的几种 */
const PLOT_KINDS: Item[] = [
  { label: 'bar', detail: '柱状图' },
  { label: 'barh', detail: '横着的柱状图' },
  { label: 'line', detail: '折线图' },
  { label: 'pie', detail: '饼图' },
  { label: 'hist', detail: '直方图' },
  { label: 'scatter', detail: '散点图', info: "df.plot.scatter(x='语文', y='数学')" },
  { label: 'box', detail: '箱线图' },
]

/** `.str.` 后面：一列文字的处理 */
const STR: Item[] = [
  { label: 'contains', detail: '包含某段文字', call: "contains('')" },
  { label: 'startswith', detail: '以…开头', call: "startswith('')" },
  { label: 'endswith', detail: '以…结尾', call: "endswith('')" },
  { label: 'len', detail: '每个有几个字' },
  { label: 'replace', detail: '替换', call: "replace('', '')" },
  { label: 'split', detail: '拆开' },
  { label: 'strip', detail: '去掉两头的空格' },
]

const MODULES: Record<string, Item[]> = { pd: PD, plt: PLT, np: NP, sns: SNS, jieba: JIEBA, plot: PLOT_KINDS, str: STR }

/** 没有点号时额外给的：常用的名字和三句 import */
const TOP: Completion[] = [
  { label: 'import pandas as pd', detail: '用 pandas', type: 'text', boost: 60 },
  { label: 'import matplotlib.pyplot as plt', detail: '用画图', type: 'text', boost: 60 },
  { label: 'import numpy as np', detail: '用 numpy', type: 'text', boost: 40 },
  { label: 'import seaborn as sns', detail: '用 seaborn', type: 'text', boost: 30 },
  { label: 'import jieba', detail: '用中文分词', type: 'text', boost: 30 },
  { label: 'from wordcloud import WordCloud', detail: '用词云', type: 'text', boost: 30 },
  toCompletion({ label: 'WordCloud', detail: '词云', info: "WordCloud(width=600, height=300, background_color='white').generate(用空格隔开的词)" }, 20),
]

const pythonCompletion = enhanceCompletion('Python')

/** `columns()` 给出素材表的列名（页面上已经读出来的预览）；每次补全时现取，素材变了不用重建编辑器 */
export function dataAnalysisCompletion(columns: () => string[]): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    // df[' 的引号里：列名
    const inQuote = context.matchBefore(/\[\s*['"][^'"\]\n]*$/)
    if (inQuote) {
      const typed = /[^'"]*$/.exec(inQuote.text)![0]
      const names = [...new Set(columns())]
      if (!names.length) return null
      return {
        from: context.pos - typed.length,
        options: names.map((name) => ({ label: name, detail: '素材里的列', type: 'property', boost: 99 })),
        validFor: /^[^'"\]]*$/,
      }
    }

    // 点号后面：看点号前面是谁
    const dotted = context.matchBefore(/(\w+)\s*(\([^()]*\)|\[[^[\]]*\])?\.\w*$/)
    if (dotted) {
      const owner = /^(\w+)/.exec(dotted.text)![1]!
      const called = /[)\]]\s*\.\w*$/.test(dotted.text)
      const list = (!called && MODULES[owner]) || FRAME
      const typed = /\w*$/.exec(dotted.text)![0]
      return { from: context.pos - typed.length, options: list.map((item) => toCompletion(item, 50)), validFor: /^\w*$/ }
    }

    const base = await pythonCompletion(context)
    if (!base) return null
    return { ...base, options: [...base.options, ...TOP] }
  }
}
