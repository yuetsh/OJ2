import type { AstRule } from "@oj2/contract"
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
  return rule.label || rule.target || "指定语法"
}

function rangeDescription(subject: string, rule: AstRule) {
  if (rule.message) return rule.message
  if (rule.exact !== undefined) return `${subject} 出现 ${rule.exact} 次`
  const parts: string[] = []
  if (rule.min !== undefined) parts.push(`至少 ${rule.min} 次`)
  if (rule.max !== undefined) parts.push(`至多 ${rule.max} 次`)
  return `${subject} ${parts.join("、")}`.trim()
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
        description: rule.message || `必须使用 ${targetName(rule)}`,
        passed: hasNode(root, nodeType),
      }
    case "must_not_exist_node":
      return {
        description: rule.message || `不能使用 ${targetName(rule)}`,
        passed: !hasNode(root, nodeType),
      }
    case "count_node": {
      const count = collectNodes(root, nodeType).length
      return {
        description: rangeDescription(targetName(rule), rule),
        passed: rangePassed(count, rule),
      }
    }
    case "must_call_function":
      return {
        description: rule.message || `必须调用 ${target}()`,
        passed: functionCalls(root, target, language).length > 0,
      }
    case "must_not_call_function":
      return {
        description: rule.message || `不能调用 ${target}()`,
        passed: functionCalls(root, target, language).length === 0,
      }
    case "count_function_call": {
      const count = functionCalls(root, target, language).length
      return {
        description: rangeDescription(`${target}()`, rule),
        passed: rangePassed(count, rule),
      }
    }
    case "must_call_method":
      return {
        description: rule.message || `必须调用 .${target}()`,
        passed: methodCalls(root, target, language).length > 0,
      }
    case "must_not_call_method":
      return {
        description: rule.message || `不能调用 .${target}()`,
        passed: methodCalls(root, target, language).length === 0,
      }
    case "must_use_operator":
      return {
        description: rule.message || `必须使用 ${target} 运算符`,
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
      return {
        description:
          rule.message ||
          (outer === inner
            ? `必须使用 ${outer} 嵌套`
            : `必须在 ${outer} 中嵌套使用 ${inner}`),
        passed,
      }
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
