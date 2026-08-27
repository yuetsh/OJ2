import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"

/**
 * 题目难度。生产库 956 道题只有这三个值（旧 Django 的 Problem.difficulty choices
 * 也是这三个），前端的 DIFFICULTY 映射表按它建 —— 写成 z.string() 的话
 * 多出来的值会静默渲染成 undefined。
 */
export const problemDifficultySchema = z.enum(["Low", "Mid", "High"])

/**
 * SQL 题配置与展示数据。两者都是 `problem.sql_config` / `problem.sql_display`
 * 的 **JSONB 原文**，所以键名保持 snake_case —— 生产库 9 道 SQL 题存的就是这个形状
 * （移植自旧后端 `judge/sql_runner.py:build_display`，逐条比对过，键集完全一致）。
 *
 * 写成精确 schema 而不是 `z.record(z.unknown())`：前端原来得自己手抄一份
 * SQLDisplay 接口才能渲染表格，抄错了没人拦得住。
 */
export const sqlConfigSchema = z.object({
  mode: z.enum(["query", "modify"]),
  order_sensitive: z.boolean(),
})

/** 表格里的单元格。SQLite 只会给出这三种；BLOB 在落库前已转成十六进制字符串 */
const sqlCellSchema = z.union([z.string(), z.number(), z.null()])

const sqlDisplayColumnSchema = z.object({
  name: z.string(),
  /** 表达式/聚合列（COUNT(*)、别名）在数据表里无同名列，类型为空串，前端据此隐藏 */
  type: z.string(),
})

const sqlResultSetSchema = z.object({
  columns: z.array(sqlDisplayColumnSchema),
  rows: z.array(z.array(sqlCellSchema)),
  total_rows: z.number().int().nonnegative(),
  truncated: z.boolean(),
})

export const sqlDisplayTableSchema = sqlResultSetSchema.extend({
  name: z.string(),
  /** 被标准答案 DROP 的表：条目用初始数据补齐、rows 清空，前端提示「表已删除」 */
  dropped: z.boolean().optional(),
})

export const sqlDisplaySchema = z.object({
  tables: z.array(sqlDisplayTableSchema),
  // query 题给结果集，modify 题给改动后的表 —— 两种形态，前端按有没有
  // changed_tables 分支
  expected: z.union([
    sqlResultSetSchema,
    z.object({ changed_tables: z.array(sqlDisplayTableSchema) }),
  ]),
})

/**
 * AST 代码要求。同一个形状原来在**三个地方**各写了一份，三份都不一样：
 * apps/api/src/judge/ast.ts 的 AstRule（判题机真读的那份，九个字段）、
 * apps/web/src/utils/types.ts 的 AstRules（少了 label / exact / outer / inner）、
 * AstRulesEditor.vue 里的本地 AstRule（少了 outer / inner）。
 * 编辑器写得出 label / exact，题目类型却描述不了它们。现在以这里为准。
 *
 * 除 engine 外全部可选：判题机每条规则只读自己那几个字段
 * （见 ast.ts 的 evaluateRule），缺了就走默认文案。
 */
export const astRuleEngineSchema = z.enum([
  "must_exist_node",
  "must_not_exist_node",
  "count_node",
  "must_call_function",
  "must_not_call_function",
  "count_function_call",
  "must_call_method",
  "must_not_call_method",
  "must_use_operator",
  // 判题机实现了，但后台编辑器还没有对应的选项，目前只能手工造数据用上
  "must_have_nesting",
])

export const astRuleSchema = z.object({
  engine: astRuleEngineSchema,
  /** 检查目标：节点类型 / 函数名 / 方法名 / 运算符，按 engine 而定 */
  target: z.string().optional(),
  /** must_have_nesting 专用：外层、内层节点 */
  outer: z.string().optional(),
  inner: z.string().optional(),
  /** 展示用的中文名，缺省回落到 target */
  label: z.string().optional(),
  /** 自定义提示。生产库里存的是空串而不是缺键，判题机按 `||` 回落到默认文案 */
  message: z.string().optional(),
  /** count_* 引擎的次数约束 */
  exact: z.number().int().optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
})

/** 按语言分组：`{ Python3: [...], C: [...] }`，键是 languages 里的语言名 */
export const astRulesSchema = z.record(z.string(), z.array(astRuleSchema))

/**
 * 每种语言支持哪些节点 target，以及它的中文名。原来这里是一张 15 条的混合表，
 * C 和 Python 的节点混在一起铺成后台下拉（更早之前 AstRulesEditor.vue 和
 * ProblemContent.vue 还各手抄了一份）。
 *
 * **键必须和 judge/ast.ts 的 mappings 逐一对齐** —— 那边是 target → tree-sitter
 * 节点类型，这边是 target → 中文名。少一边就是静默故障：老师给 C 题选到只有
 * Python 有的 `list_comprehension`，判题机 `mapping[target] ?? target` 拿裸名去比
 * 节点类型，C 的语法树里永远不存在它，于是「必须使用列表推导式」永远失败、
 * 「不能使用 f-string」永远通过，两头都不报错。
 */
export const AST_NODE_TARGETS_BY_LANGUAGE: Record<string, Record<string, string>> = {
  C: {
    for_loop: "for 循环",
    while_loop: "while 循环",
    do_while: "do-while 循环",
    if_statement: "if 条件",
    else_clause: "else 子句",
    switch_statement: "switch 语句",
    case_statement: "case 分支",
    break: "break 语句",
    continue: "continue 语句",
    return: "return 语句",
    function_definition: "函数定义",
    assignment: "赋值语句",
    struct: "结构体",
    include: "#include 指令",
  },
  // tree-sitter-cpp 继承 tree-sitter-c 的语法，C 那 14 条 target 在 C++ 树里
  // 逐个实测通用，所以这张表是「C 的全集 + C++ 独有的几条」
  "C++": {
    for_loop: "for 循环",
    range_for_loop: "范围 for 循环",
    while_loop: "while 循环",
    do_while: "do-while 循环",
    if_statement: "if 条件",
    else_clause: "else 子句",
    switch_statement: "switch 语句",
    case_statement: "case 分支",
    break: "break 语句",
    continue: "continue 语句",
    return: "return 语句",
    function_definition: "函数定义",
    class_definition: "类定义",
    struct: "结构体",
    assignment: "赋值语句",
    include: "#include 指令",
    try_except: "try-catch",
    throw: "throw 语句",
    namespace: "namespace 定义",
    template: "模板定义",
    lambda: "lambda 表达式",
    using: "using 声明",
  },
  Python3: {
    for_loop: "for 循环",
    while_loop: "while 循环",
    if_statement: "if 条件",
    elif_clause: "elif 子句",
    else_clause: "else 子句",
    break: "break 语句",
    continue: "continue 语句",
    return: "return 语句",
    function_definition: "函数定义",
    class_definition: "类定义",
    assignment: "赋值语句",
    try_except: "try-except",
    with_statement: "with 语句",
    import: "import 语句",
    import_from: "from-import 语句",
    list_comprehension: "列表推导式",
    list_literal: "列表",
    dict_literal: "字典",
    set_literal: "集合",
    f_string: "f-string",
  },
}

/**
 * 运算符 target → 该语言里的实际写法。逻辑名 `and` / `or` / `not` 在 C 里写作
 * `&&` / `||` / `!`，判题机按 mappings 翻译，文案这边也得翻 —— 否则 C 题的学生
 * 看到的要求是「必须使用 and 运算符」，而 C 里根本没有 `and` 这个词。
 *
 * 恒等的那些条目（`+`、`==` …）判题机的 mappings 里已经删掉了，走 `?? target`
 * 回落到同一个值；这里保留完整列表是因为它同时是后台下拉的选项来源。
 */
export const AST_OPERATOR_TARGETS_BY_LANGUAGE: Record<string, Record<string, string>> = {
  C: {
    "+": "+", "-": "-", "*": "*", "/": "/", "%": "%",
    "+=": "+=", "-=": "-=", "*=": "*=", "/=": "/=", "%=": "%=",
    "++": "++", "--": "--",
    "==": "==", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=",
    and: "&&", or: "||", not: "!",
    "&": "&", "|": "|",
  },
  // `<<` / `>>` 对 C++ 主要是 cout/cin 的流运算符（位移是同一个 token）
  "C++": {
    "+": "+", "-": "-", "*": "*", "/": "/", "%": "%",
    "+=": "+=", "-=": "-=", "*=": "*=", "/=": "/=", "%=": "%=",
    "++": "++", "--": "--",
    "==": "==", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=",
    and: "&&", or: "||", not: "!",
    "&": "&", "|": "|", "<<": "<<", ">>": ">>",
  },
  Python3: {
    "+": "+", "-": "-", "*": "*", "/": "/", "//": "//", "%": "%", "**": "**",
    "+=": "+=", "-=": "-=", "*=": "*=", "/=": "/=", "%=": "%=",
    "==": "==", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=",
    and: "and", or: "or", not: "not",
    "&": "&", "|": "|",
  },
}

/**
 * 判题机真正能做 AST 检查的语言。设计文档写的是"支持全部 6 种语言"，落地的只有
 * 这两种 —— 其余语言 judge/ast.ts 的 loadLanguage 返回 null，规则一条都不会跑。
 * 所以后台不给别的语言开 tab，题目页也不把它们的规则展示成「要求」。
 */
export const AST_SUPPORTED_LANGUAGES = Object.keys(AST_NODE_TARGETS_BY_LANGUAGE)

/** 全语言的节点中文名并集，只给拿不到语言的场合做回落。有语言一律走 astNodeLabel() */
export const AST_NODE_TARGET_LABELS: Record<string, string> = Object.assign(
  {},
  ...Object.values(AST_NODE_TARGETS_BY_LANGUAGE),
)

export function astNodeLabel(target: string, language?: string): string {
  const table = language ? AST_NODE_TARGETS_BY_LANGUAGE[language] : undefined
  return table?.[target] ?? AST_NODE_TARGET_LABELS[target] ?? target
}

export function astOperatorLabel(target: string, language?: string): string {
  return (language ? AST_OPERATOR_TARGETS_BY_LANGUAGE[language]?.[target] : undefined) ?? target
}

/**
 * count_* 引擎至少要有一个数字约束，否则这条规则恒真 —— rangePassed 三个字段全
 * undefined 直接返回 true，描述也退化成光秃秃一个「for 循环」。编辑器切到
 * 「出现次数」时会清掉 exact/min/max，老师不填数字就会存出这种规则。
 *
 * 读取路径（判题、题目页要求）用它把这种规则整条丢掉，而不是让 schema 校验失败：
 * astRulesSchema 同时用于**读**后台题目详情，在那儿抛错会让整个详情打不开。
 */
export function astRuleIsMeaningful(rule: {
  engine: string
  exact?: number
  min?: number
  max?: number
}): boolean {
  if (!rule.engine.startsWith("count")) return true
  return rule.exact !== undefined || rule.min !== undefined || rule.max !== undefined
}

/**
 * 下发给**学生**的代码要求。只有渲染要用的两个字段 —— 文案由后端生成，
 * engine / target 这些内部字段不出现在响应里。
 *
 * 旧后端的 ProblemSerializer 没排掉 ast_rules，学生拿到的是规则原文；阶段 3
 * 泄露评审刻意收掉了它，同时写明「前端要读具体内容的话得补个专门的字段」——
 * 就是这个。收紧保留，展示恢复。
 */
export const astRequirementSchema = z.object({
  /** 已经渲染好的中文文案，例如「if 条件 出现 2 次」 */
  description: z.string(),
  /** 标签配色：必须做 / 不能做 / 次数约束 */
  kind: z.enum(["require", "forbid", "count"]),
})

/** 按语言分组，与 astRulesSchema 同一套键 */
export const astRequirementsSchema = z.record(
  z.string(),
  z.array(astRequirementSchema),
)

export const problemDetailSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
  description: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  samples: z.array(
    z.object({
      input: z.string(),
      output: z.string(),
    }),
  ),
  hint: z.string().nullable(),
  languages: z.array(z.string()),
  template: z.record(z.string(), z.string()),
  createTime: z.string(),
  lastUpdateTime: z.string().nullable(),
  timeLimit: z.number().int(),
  memoryLimit: z.number().int(),
  difficulty: problemDifficultySchema,
  source: z.string().nullable(),
  prompt: z.string().nullable(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
  statisticInfo: z.record(z.string(), z.unknown()),
  shareSubmission: z.boolean(),
  contestId: z.number().int().nullable(),
  tags: z.array(z.string()),
  createdBy: z.object({
    id: z.number().int(),
    username: z.string(),
    realName: z.string().nullable(),
  }),
  myStatus: z.number().int().nullable(),
  myFailedCount: z.number().int(),
  allowFlowchart: z.boolean(),
  showFlowchart: z.boolean(),
  mermaidCode: z.string().nullable(),
  flowchartData: z.record(z.string(), z.unknown()).nullable(),
  flowchartHint: z.string().nullable(),
  sqlConfig: sqlConfigSchema.nullable(),
  sqlDisplay: sqlDisplaySchema.nullable(),
  // 代码要求（AST 规则的展示投影）。规则原文不下发给学生，见 astRequirementSchema
  astRequirements: astRequirementsSchema.nullable(),
})

export type ProblemDetail = z.infer<typeof problemDetailSchema>

export const problemListItemSchema = z.object({
  id: z.number().int(),
  _id: z.string(),
  title: z.string(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
  difficulty: problemDifficultySchema,
  createdBy: sampleUserSchema,
  tags: z.array(z.string()),
  contestId: z.number().int().nullable(),
  allowFlowchart: z.boolean(),
  showFlowchart: z.boolean(),
  hasAstRules: z.boolean(),
  myStatus: z.number().int().nullable(),
})

export const problemListSchema = paginatedSchema(problemListItemSchema)

export const tagSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  problemCount: z.number().int().nonnegative(),
})

export const problemAuthorSchema = z.object({
  username: z.string(),
  problemCount: z.number().int().nonnegative(),
})

export const yearlyAcSchema = z.object({
  year: z.number().int(),
  total: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  acRate: z.number(),
})

export type AstRuleEngine = z.infer<typeof astRuleEngineSchema>
export type AstRule = z.infer<typeof astRuleSchema>
export type AstRules = z.infer<typeof astRulesSchema>
export type AstRequirement = z.infer<typeof astRequirementSchema>
export type AstRequirements = z.infer<typeof astRequirementsSchema>
export type ProblemDifficulty = z.infer<typeof problemDifficultySchema>
export type ProblemListItem = z.infer<typeof problemListItemSchema>
export type ProblemList = z.infer<typeof problemListSchema>
export type Tag = z.infer<typeof tagSchema>
export type ProblemAuthor = z.infer<typeof problemAuthorSchema>
export type SqlConfig = z.infer<typeof sqlConfigSchema>
export type SqlDisplay = z.infer<typeof sqlDisplaySchema>
export type SqlDisplayTable = z.infer<typeof sqlDisplayTableSchema>
export type SqlDisplayColumn = z.infer<typeof sqlDisplayColumnSchema>
export type YearlyAc = z.infer<typeof yearlyAcSchema>
