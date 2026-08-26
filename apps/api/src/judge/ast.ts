import {
  astRuleSchema,
  AST_NODE_TARGET_LABELS,
  type AstRequirement,
  type AstRequirements,
  type AstRule,
} from "@oj2/contract"
import { Language, Parser, type Node } from "web-tree-sitter"
// 语法 wasm 内嵌成资源。原来是 `Bun.resolveSync(pkg + "/" + name, import.meta.dir)`，
// 编译成单二进制后 import.meta.dir 是 /$bunfs/root，解析不到 node_modules。见 vendor/jieba.ts
import cWasmPath from "tree-sitter-c/tree-sitter-c.wasm" with { type: "file" }
import pythonWasmPath from "tree-sitter-python/tree-sitter-python.wasm" with { type: "file" }
// web-tree-sitter 自己的运行时 wasm，Parser.init() 要用
import treeSitterWasmPath from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" }

// AstRule 的形状在契约里（astRuleSchema）—— 原来这份和前端两份各写各的。
// 这里 re-export，判题机的调用方不用再去 import 契约。
export type { AstRule } from "@oj2/contract"

export interface AstResult {
  description: string
  passed: boolean
}

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

  const loaded = await Language.load(language === "C" ? cWasmPath : pythonWasmPath)
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

function targetName(rule: AstRule) {
  const target = rule.target ?? ""
  return rule.label || AST_NODE_TARGET_LABELS[target] || target || "指定语法"
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
export function describeAstRule(rule: AstRule): string {
  if (rule.message) return rule.message
  const name = targetName(rule)
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
      return `必须使用 ${target} 运算符`
    case "must_have_nesting": {
      const outer = rule.outer ?? ""
      const inner = rule.inner ?? ""
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
 */
export function astRequirements(value: unknown): AstRequirements | null {
  const grouped = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
  if (!grouped) return null
  const out: AstRequirements = {}
  for (const [language, rules] of Object.entries(grouped)) {
    if (!Array.isArray(rules)) continue
    const items = rules.flatMap((rule) => {
      const parsed = astRuleSchema.safeParse(rule)
      if (!parsed.success) return []
      return [{
        description: describeAstRule(parsed.data),
        kind: requirementKind(parsed.data.engine),
      }]
    })
    if (items.length > 0) out[language] = items
  }
  return Object.keys(out).length > 0 ? out : null
}

function rangePassed(count: number, rule: AstRule) {
  if (rule.exact !== undefined && count !== rule.exact) return false
  if (rule.min !== undefined && count < rule.min) return false
  if (rule.max !== undefined && count > rule.max) return false
  return true
}

function functionCalls(root: Node, target: string, language: string) {
  const callType = language === "C" ? "call_expression" : "call"
  return collectNodes(root, callType).filter((call) => {
    const fn = call.childForFieldName("function")
    return fn?.type === "identifier" && fn.text === target
  })
}

function methodCalls(root: Node, target: string, language: string) {
  if (language === "C") return []
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
        description: describeAstRule(rule),
        passed: hasNode(root, nodeType),
      }
    case "must_not_exist_node":
      return {
        description: describeAstRule(rule),
        passed: !hasNode(root, nodeType),
      }
    case "count_node": {
      const count = collectNodes(root, nodeType).length
      return {
        description: describeAstRule(rule),
        passed: rangePassed(count, rule),
      }
    }
    case "must_call_function":
      return {
        description: describeAstRule(rule),
        passed: functionCalls(root, target, language).length > 0,
      }
    case "must_not_call_function":
      return {
        description: describeAstRule(rule),
        passed: functionCalls(root, target, language).length === 0,
      }
    case "count_function_call": {
      const count = functionCalls(root, target, language).length
      return {
        description: describeAstRule(rule),
        passed: rangePassed(count, rule),
      }
    }
    case "must_call_method":
      return {
        description: describeAstRule(rule),
        passed: methodCalls(root, target, language).length > 0,
      }
    case "must_not_call_method":
      return {
        description: describeAstRule(rule),
        passed: methodCalls(root, target, language).length === 0,
      }
    case "must_use_operator":
      return {
        description: describeAstRule(rule),
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
      return { description: describeAstRule(rule), passed }
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
