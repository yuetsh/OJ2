import { Language, Parser, type Node } from "web-tree-sitter"

export interface AstRule {
  engine?: string
  target?: string
  outer?: string
  inner?: string
  label?: string
  message?: string
  exact?: number
  min?: number
  max?: number
}

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
  if (!initPromise) initPromise = Parser.init()
  await initPromise

  const cached = languages.get(language)
  if (cached) return cached

  const packageName = language === "C" ? "tree-sitter-c" : "tree-sitter-python"
  const wasmName = language === "C" ? "tree-sitter-c.wasm" : "tree-sitter-python.wasm"
  const wasmPath = Bun.resolveSync(`${packageName}/${wasmName}`, import.meta.dir)
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
