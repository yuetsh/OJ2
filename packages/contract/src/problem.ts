import { z } from "zod"

import { paginatedSchema, sampleUserSchema } from "./common"
import { problemLanguageSchema } from "./language"

/**
 * 题目难度。生产库 956 道题只有这三个值（旧 Django 的 Problem.difficulty choices
 * 也是这三个），前端的 DIFFICULTY 映射表按它建 —— 写成 z.string() 的话
 * 多出来的值会静默渲染成 undefined。
 */
export const problemDifficultySchema = z.enum(["Low", "Mid", "High"])

/**
 * 题目详情/列表里的难度。**可为 null** —— 比赛进行中、看的人又不是管理员时，
 * 难度和提交数一样属于「先别告诉参赛者」的信息（旧 Django 的
 * `ProblemSafeSerializer` 直接把 difficulty 放进 exclude，字段整个不下发）。
 *
 * 端上必须当「没有」处理，不要拿它去查 DIFFICULTY 映射表 —— 这正是
 * problemDifficultySchema 写成严格枚举要防的那件事。
 */
export const maskedProblemDifficultySchema = problemDifficultySchema.nullable()

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
 * 一个 target 一条，`label` 给人看（后台下拉、题目页的「要求」），`node` 给判题机
 * 拿去比 tree-sitter 的节点类型。
 *
 * **这两半原来是分在两个包里的两张表** —— 这边 target → 中文名，
 * `apps/api/src/judge/ast.ts` 的 mappings 是 target → tree-sitter 节点类型，靠一句
 * 「两边必须同增同减」的注释维持。只加一边是静默错判：老师给 C 题选到只有 Python
 * 有的 `list_comprehension`，判题机 `mapping[target] ?? target` 拿裸名去比节点类型，
 * C 的语法树里永远不存在它，于是「必须使用列表推导式」永远失败、「不能使用
 * f-string」永远通过，两头都不报错，只有学生受着。并成一张之后，加 target 而漏配
 * 节点类型在结构上就不可能了。
 *
 * （更早之前 AstRulesEditor.vue 和 ProblemContent.vue 还各手抄过一份中文名，
 * 且 C 和 Python 的节点混在一张 15 条的表里铺成后台下拉。）
 */
export interface AstNodeTarget {
  /** 后台下拉和题目页展示的中文名 */
  label: string
  /** tree-sitter 里对应的节点类型，判题机按它 collectNodes */
  node: string
}

const C_NODE_TARGETS = {
  for_loop: { label: "for 循环", node: "for_statement" },
  while_loop: { label: "while 循环", node: "while_statement" },
  do_while: { label: "do-while 循环", node: "do_statement" },
  if_statement: { label: "if 条件", node: "if_statement" },
  else_clause: { label: "else 子句", node: "else_clause" },
  switch_statement: { label: "switch 语句", node: "switch_statement" },
  case_statement: { label: "case 分支", node: "case_statement" },
  break: { label: "break 语句", node: "break_statement" },
  continue: { label: "continue 语句", node: "continue_statement" },
  return: { label: "return 语句", node: "return_statement" },
  function_definition: { label: "函数定义", node: "function_definition" },
  assignment: { label: "赋值语句", node: "assignment_expression" },
  struct: { label: "结构体", node: "struct_specifier" },
  include: { label: "#include 指令", node: "preproc_include" },
} satisfies Record<string, AstNodeTarget>

export const AST_NODE_TARGETS_BY_LANGUAGE: Record<string, Record<string, AstNodeTarget>> = {
  C: C_NODE_TARGETS,
  /**
   * tree-sitter-cpp 继承 tree-sitter-c 的语法，C 那 14 条在 C++ 树里逐个实测通用，
   * 所以共用的条目一律**引用** C_NODE_TARGETS 而不是抄一遍 —— 原来 C 的 14 行在
   * 契约和判题机两个文件里各抄了两遍（C 一份、C++ 一份），同一份数据四份拷贝。
   * 这里逐条列出来是为了保住下拉框的显示顺序（C++ 独有的几条是插在中间的）。
   */
  "C++": {
    for_loop: C_NODE_TARGETS.for_loop,
    range_for_loop: { label: "范围 for 循环", node: "for_range_loop" },
    while_loop: C_NODE_TARGETS.while_loop,
    do_while: C_NODE_TARGETS.do_while,
    if_statement: C_NODE_TARGETS.if_statement,
    else_clause: C_NODE_TARGETS.else_clause,
    switch_statement: C_NODE_TARGETS.switch_statement,
    case_statement: C_NODE_TARGETS.case_statement,
    break: C_NODE_TARGETS.break,
    continue: C_NODE_TARGETS.continue,
    return: C_NODE_TARGETS.return,
    function_definition: C_NODE_TARGETS.function_definition,
    class_definition: { label: "类定义", node: "class_specifier" },
    struct: C_NODE_TARGETS.struct,
    assignment: C_NODE_TARGETS.assignment,
    include: C_NODE_TARGETS.include,
    try_except: { label: "try-catch", node: "try_statement" },
    throw: { label: "throw 语句", node: "throw_statement" },
    namespace: { label: "namespace 定义", node: "namespace_definition" },
    template: { label: "模板定义", node: "template_declaration" },
    lambda: { label: "lambda 表达式", node: "lambda_expression" },
    using: { label: "using 声明", node: "using_declaration" },
  },
  Python3: {
    for_loop: { label: "for 循环", node: "for_statement" },
    while_loop: { label: "while 循环", node: "while_statement" },
    if_statement: { label: "if 条件", node: "if_statement" },
    elif_clause: { label: "elif 子句", node: "elif_clause" },
    else_clause: { label: "else 子句", node: "else_clause" },
    break: { label: "break 语句", node: "break_statement" },
    continue: { label: "continue 语句", node: "continue_statement" },
    return: { label: "return 语句", node: "return_statement" },
    function_definition: { label: "函数定义", node: "function_definition" },
    class_definition: { label: "类定义", node: "class_definition" },
    assignment: { label: "赋值语句", node: "assignment" },
    try_except: { label: "try-except", node: "try_statement" },
    with_statement: { label: "with 语句", node: "with_statement" },
    import: { label: "import 语句", node: "import_statement" },
    import_from: { label: "from-import 语句", node: "import_from_statement" },
    list_comprehension: { label: "列表推导式", node: "list_comprehension" },
    list_literal: { label: "列表", node: "list" },
    dict_literal: { label: "字典", node: "dictionary" },
    set_literal: { label: "集合", node: "set" },
    f_string: { label: "f-string", node: "format_string" },
  },
}

/**
 * 运算符 target → 该语言里的实际写法。逻辑名 `and` / `or` / `not` 在 C 里写作
 * `&&` / `||` / `!`，文案要翻（否则 C 题的学生看到「必须使用 and 运算符」，而 C 里
 * 根本没有 `and` 这个词），判题机也正好拿同一个值去比节点类型 —— 所以这张表**一份
 * 两用**，不像节点那样需要两个字段。原来判题机的 mappings 里还抄了一份非恒等的
 * （`and`→`&&` 那三条），取值逐个相同，纯属重复。
 *
 * 恒等的条目（`+`、`==` …）写全是因为这张表同时是后台下拉的选项来源。
 */
const C_OPERATOR_TARGETS = {
  "+": "+", "-": "-", "*": "*", "/": "/", "%": "%",
  "+=": "+=", "-=": "-=", "*=": "*=", "/=": "/=", "%=": "%=",
  "++": "++", "--": "--",
  "==": "==", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=",
  and: "&&", or: "||", not: "!",
  "&": "&", "|": "|",
}

export const AST_OPERATOR_TARGETS_BY_LANGUAGE: Record<string, Record<string, string>> = {
  C: C_OPERATOR_TARGETS,
  // `<<` / `>>` 对 C++ 主要是 cout/cin 的流运算符（位移是同一个 token）
  "C++": { ...C_OPERATOR_TARGETS, "<<": "<<", ">>": ">>" },
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
export const AST_NODE_TARGET_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(AST_NODE_TARGETS_BY_LANGUAGE).flatMap((table) =>
    Object.entries(table).map(([target, entry]) => [target, entry.label]),
  ),
)

export function astNodeLabel(target: string, language?: string): string {
  const table = language ? AST_NODE_TARGETS_BY_LANGUAGE[language] : undefined
  return table?.[target]?.label ?? AST_NODE_TARGET_LABELS[target] ?? target
}

/**
 * target → tree-sitter 节点类型。判题机唯一的解析入口 ——
 * 节点走上面那张表的 `node`，运算符走运算符表（它的值本身就是要比的 token），
 * 都对不上就回落到裸 target（恒等的运算符 `+` / `==` 走的就是这条）。
 */
export function astTargetNodeType(target: string, language: string): string {
  return (
    AST_NODE_TARGETS_BY_LANGUAGE[language]?.[target]?.node ??
    AST_OPERATOR_TARGETS_BY_LANGUAGE[language]?.[target] ??
    target
  )
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
  languages: z.array(problemLanguageSchema),
  /**
   * 语言 → 代码模板。**用 partialRecord 让键受语言联合约束** ——
   * 原来这里是 `z.record(z.string(), z.string())`，等价于 `Record<string, string>`，
   * 前端按语言查模板时拿不到任何键名保护（`template["Pytho3"]` 也是合法表达式）。
   *
   * partialRecord 而非 record：没配模板的语言不该出现该键（`template: {}` 是常态），
   * 用 record 会要求每一个语言键都存在。
   */
  template: z.partialRecord(problemLanguageSchema, z.string()),
  createTime: z.string(),
  lastUpdateTime: z.string().nullable(),
  timeLimit: z.number().int(),
  memoryLimit: z.number().int(),
  difficulty: maskedProblemDifficultySchema,
  source: z.string().nullable(),
  prompt: z.string().nullable(),
  submissionNumber: z.number().int(),
  acceptedNumber: z.number().int(),
  statisticInfo: z.record(z.string(), z.unknown()),
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
  difficulty: maskedProblemDifficultySchema,
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
