import {
  AST_NODE_TARGETS_BY_LANGUAGE,
  AST_OPERATOR_TARGETS_BY_LANGUAGE,
  astNodeLabel,
  astOperatorLabel,
  astRuleIsMeaningful,
  astRuleSchema,
  AST_SUPPORTED_LANGUAGES,
  type AstRequirement,
  type AstRequirements,
  type AstRule,
  type AstRules,
} from "@oj2/contract"
import { Language, Parser, type Node } from "web-tree-sitter"
// 语法 wasm 内嵌成资源。原来是 `Bun.resolveSync(pkg + "/" + name, import.meta.dir)`，
// 编译成单二进制后 import.meta.dir 是 /$bunfs/root，解析不到 node_modules。见 vendor/jieba.ts
import cWasmPath from "tree-sitter-c/tree-sitter-c.wasm" with { type: "file" }
import cppWasmPath from "tree-sitter-cpp/tree-sitter-cpp.wasm" with { type: "file" }
import pythonWasmPath from "tree-sitter-python/tree-sitter-python.wasm" with { type: "file" }
// web-tree-sitter 自己的运行时 wasm，Parser.init() 要用
import treeSitterWasmPath from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" }

// AstRule 的形状在契约里（astRuleSchema）—— 原来这份和前端两份各写各的。
// 这里 re-export，判题机的调用方不用再去 import 契约。
export type { AstRule } from "@oj2/contract"

export interface AstResult {
  description: string
  passed: boolean
  /** count_* 引擎实际数到的次数。失败时前端拿它补一句「当前 N 次」 */
  actual?: number
}

/**
 * target → tree-sitter 节点类型。恒等的条目（`+`、`==` 这些运算符）不列，
 * 走 `mapping[target] ?? target` 回落。
 *
 * **这里的键集是契约 AST_NODE_TARGETS_BY_LANGUAGE 的另一半**，两边必须同增同减：
 * 那边决定后台下拉能选什么，这边决定判题机认得什么。只加一边就是静默错判。
 */
const mappings: Record<string, Record<string, string>> = {
  C: {
    for_loop: "for_statement",
    while_loop: "while_statement",
    do_while: "do_statement",
    if_statement: "if_statement",
    else_clause: "else_clause",
    break: "break_statement",
    continue: "continue_statement",
    function_definition: "function_definition",
    return: "return_statement",
    switch_statement: "switch_statement",
    case_statement: "case_statement",
    assignment: "assignment_expression",
    struct: "struct_specifier",
    include: "preproc_include",
    and: "&&",
    or: "||",
    not: "!",
  },
  "C++": {
    // C 的那 14 条原样通用（tree-sitter-cpp 继承 tree-sitter-c 的语法）
    for_loop: "for_statement",
    while_loop: "while_statement",
    do_while: "do_statement",
    if_statement: "if_statement",
    else_clause: "else_clause",
    break: "break_statement",
    continue: "continue_statement",
    function_definition: "function_definition",
    return: "return_statement",
    switch_statement: "switch_statement",
    case_statement: "case_statement",
    assignment: "assignment_expression",
    struct: "struct_specifier",
    include: "preproc_include",
    // C++ 独有
    range_for_loop: "for_range_loop",
    class_definition: "class_specifier",
    try_except: "try_statement",
    throw: "throw_statement",
    namespace: "namespace_definition",
    template: "template_declaration",
    lambda: "lambda_expression",
    using: "using_declaration",
    and: "&&",
    or: "||",
    not: "!",
  },
  Python3: {
    for_loop: "for_statement",
    while_loop: "while_statement",
    if_statement: "if_statement",
    else_clause: "else_clause",
    elif_clause: "elif_clause",
    break: "break_statement",
    continue: "continue_statement",
    function_definition: "function_definition",
    return: "return_statement",
    try_except: "try_statement",
    with_statement: "with_statement",
    list_comprehension: "list_comprehension",
    list_literal: "list",
    dict_literal: "dictionary",
    set_literal: "set",
    f_string: "format_string",
    import: "import_statement",
    import_from: "import_from_statement",
    assignment: "assignment",
    class_definition: "class_definition",
  },
}

let initPromise: Promise<void> | undefined
const languages = new Map<string, Language>()

async function loadLanguage(language: string) {
  if (!(language in mappings)) return null
  // locateFile 指到内嵌的 tree-sitter.wasm：emscripten 默认按脚本所在目录找，
  // 单二进制里那个目录是 /$bunfs/root，它自己找不着
  if (!initPromise) initPromise = Parser.init({ locateFile: () => treeSitterWasmPath })
  await initPromise

  const cached = languages.get(language)
  if (cached) return cached

  const wasmPath = language === "C"
    ? cWasmPath
    : language === "C++"
      ? cppWasmPath
      : pythonWasmPath
  const loaded = await Language.load(wasmPath)
  languages.set(language, loaded)
  return loaded
}

function collectNodes(root: Node, type: string, result: Node[] = []) {
  if (root.type === type) result.push(root)
  for (const child of root.children) collectNodes(child, type, result)
  return result
}

function hasNode(root: Node, type: string): boolean {
  if (root.type === type) return true
  return root.children.some((child) => hasNode(child, type))
}

function targetName(rule: AstRule, language?: string) {
  const target = rule.target ?? ""
  return rule.label || astNodeLabel(target, language) || "指定语法"
}

function countPhrase(verb: string, rule: AstRule) {
  if (rule.exact !== undefined) return `${verb} ${rule.exact} 次`
  if (rule.min !== undefined && rule.max !== undefined)
    return `${verb} ${rule.min}～${rule.max} 次`
  if (rule.min !== undefined) return `至少${verb} ${rule.min} 次`
  if (rule.max !== undefined) return `至多${verb} ${rule.max} 次`
  return ""
}

/**
 * 一条规则的中文描述。判题结果（statistic_info.ast_results）和题目页的「要求」
 * 用的是同一份 —— 原来前端 ProblemContent.vue 里另有一份几乎一样的实现，
 * 只有 min/max 同时给出时的措辞不一样（生产库里没有这种规则）。
 */
export function describeAstRule(rule: AstRule, language?: string): string {
  if (rule.message) return rule.message
  const name = targetName(rule, language)
  const target = rule.target ?? ""
  switch (rule.engine) {
    case "must_exist_node":
      return `必须使用 ${name}`
    case "must_not_exist_node":
      return `不能使用 ${name}`
    case "count_node":
      return `${name} ${countPhrase("出现", rule)}`.trim()
    case "must_call_function":
      return `必须调用 ${target}()`
    case "must_not_call_function":
      return `不能调用 ${target}()`
    case "count_function_call":
      return `${target}() ${countPhrase("调用", rule)}`.trim()
    case "must_call_method":
      return `必须调用 .${target}()`
    case "must_not_call_method":
      return `不能调用 .${target}()`
    case "must_use_operator":
      return `必须使用 ${astOperatorLabel(target, language)} 运算符`
    case "must_have_nesting": {
      // 这两个走 astNodeLabel 而不是裸值 —— 少了这一步文案就是
      // 「必须使用 for_loop 嵌套」，旧栈 ast_checker/engines/nesting.py 是翻的
      const outer = astNodeLabel(rule.outer ?? "", language)
      const inner = astNodeLabel(rule.inner ?? "", language)
      return outer === inner
        ? `必须使用 ${outer} 嵌套`
        : `必须在 ${outer} 中嵌套使用 ${inner}`
    }
  }
}

/** 标签配色用的粗分类，见契约 astRequirementSchema */
function requirementKind(engine: AstRule["engine"]): AstRequirement["kind"] {
  if (engine.startsWith("must_not")) return "forbid"
  if (engine.startsWith("count")) return "count"
  return "require"
}

/**
 * 把规则原文投影成下发给学生的「代码要求」。规则里的 engine / target 不出现在
 * 响应里 —— 阶段 3 泄露评审收掉 ast_rules 时要的就是这个，见契约的注释。
 *
 * 只投影判题机真检查得了的语言。原来这里不看语言，给 C++ 题配的规则照样渲染成
 * 「必须使用 for 循环」挂在题目页上，而 loadLanguage 对 C++ 返回 null、
 * checkAst 直接放行 —— 学生看得见要求，判题从不检查。
 */
export function astRequirements(value: unknown): AstRequirements | null {
  const grouped = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
  if (!grouped) return null
  const out: AstRequirements = {}
  for (const [language, rules] of Object.entries(grouped)) {
    if (!Array.isArray(rules)) continue
    if (!AST_SUPPORTED_LANGUAGES.includes(language)) continue
    const items = rules.flatMap((rule) => {
      const parsed = astRuleSchema.safeParse(rule)
      if (!parsed.success) return []
      if (!astRuleIsMeaningful(parsed.data)) return []
      return [{
        description: describeAstRule(parsed.data, language),
        kind: requirementKind(parsed.data.engine),
      }]
    })
    if (items.length > 0) out[language] = items
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * AST 规则的语义校验。zod 只管形状（engine 在枚举里、min 是整数），管不了
 * 「给 C 题选了只有 Python 才有的 list_comprehension」这类组合 —— 那种规则存得进去，
 * 判题时 `mapping[target] ?? target` 拿裸名去比节点类型，永远失败或永远通过，
 * 两头都不报错，只有学生受着。
 *
 * 放这儿而不是 astRulesSchema 的 refine 上：那个 schema 同时用于**读**后台题目详情，
 * 在读路径上抛错会让历史脏数据直接把题目详情打不开。
 */
export function astRulesError(astRules: AstRules | null): string | null {
  if (!astRules) return null
  for (const [language, rules] of Object.entries(astRules)) {
    if (rules.length === 0) continue
    if (!AST_SUPPORTED_LANGUAGES.includes(language)) {
      return `代码规则暂不支持 ${language}，判题机只检查 ${AST_SUPPORTED_LANGUAGES.join(" / ")}`
    }
    const nodes = AST_NODE_TARGETS_BY_LANGUAGE[language] ?? {}
    const operators = AST_OPERATOR_TARGETS_BY_LANGUAGE[language] ?? {}
    for (const [index, rule] of rules.entries()) {
      const at = `代码规则 ${language} 第 ${index + 1} 条`
      const target = rule.target ?? ""
      if (rule.engine.endsWith("_node")) {
        if (!(target in nodes)) return `${at}：${language} 没有「${target}」这种语法`
      } else if (rule.engine === "must_use_operator") {
        if (!(target in operators)) return `${at}：${language} 没有「${target}」运算符`
      } else if (rule.engine === "must_have_nesting") {
        for (const value of [rule.outer ?? "", rule.inner ?? ""]) {
          if (!(value in nodes)) return `${at}：${language} 没有「${value}」这种语法`
        }
      } else if (!target.trim()) {
        return `${at}：要检查的函数名/方法名不能为空`
      }
      if (!astRuleIsMeaningful(rule)) return `${at}：次数检查至少要填一个数字`
    }
  }
  return null
}

/**
 * 保存前清掉够不着的规则分组：不在题目 languages 里的（老师改过语言列表），
 * 以及判题机检查不了的（C++ / Java / …）。两者编辑器都不给开 tab，留着就是死数据。
 *
 * 必须先剔除再校验，否则历史脏数据会把老师锁死：一道 languages 含 C++ 的题，
 * 早年配过 C++ 规则，如今 tab 里看不到那组规则，保存却被「暂不支持 C++」拦下，
 * 老师在界面上无从修改。
 */
export function pickAstRules(astRules: AstRules | null, languages: string[]): AstRules | null {
  if (!astRules) return null
  const out: AstRules = {}
  for (const [language, rules] of Object.entries(astRules)) {
    if (!languages.includes(language)) continue
    if (!AST_SUPPORTED_LANGUAGES.includes(language)) continue
    if (rules.length > 0) out[language] = rules
  }
  return Object.keys(out).length > 0 ? out : null
}

function rangePassed(count: number, rule: AstRule) {
  if (rule.exact !== undefined && count !== rule.exact) return false
  if (rule.min !== undefined && count < rule.min) return false
  if (rule.max !== undefined && count > rule.max) return false
  return true
}

const CALL_NODE_TYPES: Record<string, string> = {
  C: "call_expression",
  "C++": "call_expression",
  Python3: "call",
}

function functionCalls(root: Node, target: string, language: string) {
  const callType = CALL_NODE_TYPES[language] ?? "call"
  return collectNodes(root, callType).filter((call) => {
    const fn = call.childForFieldName("function")
    if (!fn) return false
    if (fn.type === "identifier") return fn.text === target
    // `std::sort(...)` 是 qualified_identifier。学生写 sort 还是 std::sort 取决于
    // 有没有 using namespace std，两种都得认，所以末段也比一次
    if (language === "C++" && fn.type === "qualified_identifier") {
      return fn.text === target || fn.text.split("::").pop() === target
    }
    return false
  })
}

function methodCalls(root: Node, target: string, language: string) {
  // C++ 的 `a.push_back()` / `p->push_back()` 都是 call_expression + field_expression，
  // 和 Python 的 attribute 不是一回事 —— 少了这个分支，C++ 的「必须调用 .push_back()」
  // 会静默地永远失败
  if (language === "C++") {
    return collectNodes(root, "call_expression").filter((call) => {
      const fn = call.childForFieldName("function")
      return (
        fn?.type === "field_expression" &&
        fn.childForFieldName("field")?.text === target
      )
    })
  }
  if (language !== "Python3") return []
  return collectNodes(root, "call").filter((call) => {
    const fn = call.childForFieldName("function")
    return (
      fn?.type === "attribute" &&
      fn.childForFieldName("attribute")?.text === target
    )
  })
}

function evaluateRule(
  root: Node,
  rule: AstRule,
  language: string,
  mapping: Record<string, string>,
): AstResult | null {
  const target = rule.target ?? ""
  const nodeType = mapping[target] ?? target

  switch (rule.engine) {
    case "must_exist_node":
      return {
        description: describeAstRule(rule, language),
        passed: hasNode(root, nodeType),
      }
    case "must_not_exist_node":
      return {
        description: describeAstRule(rule, language),
        passed: !hasNode(root, nodeType),
      }
    case "count_node": {
      const count = collectNodes(root, nodeType).length
      return {
        description: describeAstRule(rule, language),
        passed: rangePassed(count, rule),
        actual: count,
      }
    }
    case "must_call_function":
      return {
        description: describeAstRule(rule, language),
        passed: functionCalls(root, target, language).length > 0,
      }
    case "must_not_call_function":
      return {
        description: describeAstRule(rule, language),
        passed: functionCalls(root, target, language).length === 0,
      }
    case "count_function_call": {
      const count = functionCalls(root, target, language).length
      return {
        description: describeAstRule(rule, language),
        passed: rangePassed(count, rule),
        actual: count,
      }
    }
    case "must_call_method":
      return {
        description: describeAstRule(rule, language),
        passed: methodCalls(root, target, language).length > 0,
      }
    case "must_not_call_method":
      return {
        description: describeAstRule(rule, language),
        passed: methodCalls(root, target, language).length === 0,
      }
    case "must_use_operator":
      return {
        description: describeAstRule(rule, language),
        passed: hasNode(root, nodeType),
      }
    case "must_have_nesting": {
      const outer = rule.outer ?? ""
      const inner = rule.inner ?? ""
      const outerType = mapping[outer] ?? outer
      const innerType = mapping[inner] ?? inner
      const passed = collectNodes(root, outerType).some((node) =>
        node.children.some((child) => hasNode(child, innerType)),
      )
      return { description: describeAstRule(rule, language), passed }
    }
    default:
      return null
  }
}

export async function checkAst(
  code: string,
  language: string,
  rules: AstRule[],
): Promise<{ passed: boolean; results: AstResult[] }> {
  if (rules.length === 0) return { passed: true, results: [] }

  const treeSitterLanguage = await loadLanguage(language)
  if (!treeSitterLanguage) return { passed: true, results: [] }

  const parser = new Parser()
  try {
    parser.setLanguage(treeSitterLanguage)
    const tree = parser.parse(code)
    if (!tree) return { passed: true, results: [] }
    try {
      const mapping = mappings[language] ?? {}
      const results = rules
        .filter(astRuleIsMeaningful)
        .map((rule) => evaluateRule(tree.rootNode, rule, language, mapping))
        .filter((result): result is AstResult => result !== null)
      return { passed: results.every((result) => result.passed), results }
    } finally {
      tree.delete()
    }
  } catch {
    return { passed: true, results: [] }
  } finally {
    parser.delete()
  }
}
