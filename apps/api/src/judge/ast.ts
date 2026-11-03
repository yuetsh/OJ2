import {
  AST_NODE_TARGETS_BY_LANGUAGE,
  AST_OPERATOR_TARGETS_BY_LANGUAGE,
  astNodeLabel,
  astOperatorLabel,
  astRuleIsMeaningful,
  astTargetNodeType,
  astRuleSchema,
  AST_SUPPORTED_LANGUAGES,
  type AstRequirement,
  type AstRequirements,
  type AstRule,
  type AstRules,
} from '@oj2/contract'
import { Language, Parser, type Node } from 'web-tree-sitter'
// 语法 wasm 内嵌成资源。原来是 `Bun.resolveSync(pkg + "/" + name, import.meta.dir)`，
// 编译成单二进制后 import.meta.dir 是 /$bunfs/root，解析不到 node_modules。见 vendor/jieba.ts
import cWasmPath from 'tree-sitter-c/tree-sitter-c.wasm' with { type: 'file' }
import cppWasmPath from 'tree-sitter-cpp/tree-sitter-cpp.wasm' with { type: 'file' }
import pythonWasmPath from 'tree-sitter-python/tree-sitter-python.wasm' with { type: 'file' }
// web-tree-sitter 自己的运行时 wasm，Parser.init() 要用
import treeSitterWasmPath from 'web-tree-sitter/web-tree-sitter.wasm' with { type: 'file' }

// AstRule 的形状在契约里（astRuleSchema）—— 原来这份和前端两份各写各的。
// 这里 re-export，判题机的调用方不用再去 import 契约。
export type { AstRule } from '@oj2/contract'

export interface AstResult {
  description: string
  passed: boolean
  /** count_* 引擎实际数到的次数。失败时前端拿它补一句「当前 N 次」 */
  actual?: number
  /** 没过的「不能用 X」「X 太多」：X 在第几行（1 起），挑战没做到时编辑器里标出来 */
  lines?: number[]
}

/** 节点所在的行，去重排序。submission.code 只是学生写的那段，不含题目模板，行号不用再扣 */
function linesOf(nodes: Node[]) {
  return [...new Set(nodes.map((node) => node.startPosition.row + 1))].sort((a, b) => a - b)
}

/** 没过才带行号：过了的规则不用标 */
function withLines(result: AstResult, nodes: Node[]): AstResult {
  return result.passed || nodes.length === 0 ? result : { ...result, lines: linesOf(nodes) }
}

let initPromise: Promise<void> | undefined
const languages = new Map<string, Language>()

async function loadLanguage(language: string) {
  if (!AST_SUPPORTED_LANGUAGES.includes(language)) return null
  // locateFile 指到内嵌的 tree-sitter.wasm：emscripten 默认按脚本所在目录找，
  // 单二进制里那个目录是 /$bunfs/root，它自己找不着
  if (!initPromise) initPromise = Parser.init({ locateFile: () => treeSitterWasmPath })
  await initPromise

  const cached = languages.get(language)
  if (cached) return cached

  const wasmPath = language === 'C' ? cWasmPath : language === 'C++' ? cppWasmPath : pythonWasmPath
  const loaded = await Language.load(wasmPath)
  languages.set(language, loaded)
  return loaded
}

type Match = (node: Node) => boolean

function collectNodes(root: Node, match: Match, result: Node[] = []) {
  if (match(root)) result.push(root)
  for (const child of root.children) collectNodes(child, match, result)
  return result
}

function hasNode(root: Node, match: Match): boolean {
  if (match(root)) return true
  return root.children.some((child) => hasNode(child, match))
}

const ofType =
  (type: string): Match =>
  (node) =>
    node.type === type

/** C / C++ 函数定义的函数名：`int *f()` 的名字在 pointer_declarator 里面一层，沿着 declarator 往里找 */
function functionName(definition: Node) {
  let declarator = definition.childForFieldName('declarator')
  while (declarator && declarator.type !== 'function_declarator') declarator = declarator.childForFieldName('declarator')
  return declarator?.childForFieldName('declarator')?.text
}

/**
 * 语法 target 认哪些节点。多数就是比节点类型，例外：
 *
 * C / C++ 的「函数定义」不算 `main` —— 每个 C 程序都有 main，算进去的话「必须使用函数定义」
 * 永远通过、「不能使用」永远失败，老师选它要的是「自己写了函数」。所以 C 那边叫「自定义函数」。
 *
 * Python 的「赋值语句」连 `s += 1` 一起算 —— 和 C 一个口径（C 的 assignment_expression
 * 本来就包括 `+=`），学生也是这么理解的。tree-sitter-python 里 `+=` 是单独的 augmented_assignment。
 */
function nodeMatch(target: string, language: string): Match {
  const type = astTargetNodeType(target, language)
  if (target === 'function_definition' && language !== 'Python') {
    return (node) => node.type === type && functionName(node) !== 'main'
  }
  if (target === 'assignment' && language === 'Python') {
    return (node) => node.type === type || node.type === 'augmented_assignment'
  }
  return ofType(type)
}

/**
 * 运算符只认真在做运算的那一个 token。光比 token 的话，下面这些全都算「用了」：
 * C 的 `scanf("%d", &n)` 算 `&`、`int *p` 算 `*`，C++ 的 `vector<int>` 算 `>`，
 * Python 的 `*args` / `from m import *` 算 `*`、`**kw` 算 `**`、`not in` / `is not` 算 `not`、
 * `case 1 | 2` 算 `|`。所以看它的父节点：二元运算、复合赋值、自增自减。
 *
 * 一元的只认取反（`!x` / `not x`）。负号 `-x` 不算「用了减号」，同理 `*p` 不算乘、`&n` 不算按位与。
 */
const OPERATOR_PARENTS: Record<string, string[]> = {
  C: ['binary_expression', 'assignment_expression', 'update_expression'],
  'C++': ['binary_expression', 'assignment_expression', 'update_expression'],
  Python: ['binary_operator', 'boolean_operator', 'comparison_operator', 'augmented_assignment'],
}
const NOT_PARENTS: Record<string, string[]> = {
  C: ['unary_expression'],
  'C++': ['unary_expression'],
  Python: ['not_operator'],
}

function operatorMatch(target: string, language: string): Match {
  const type = astTargetNodeType(target, language)
  const parents = (target === 'not' ? NOT_PARENTS : OPERATOR_PARENTS)[language] ?? []
  return (node) => node.type === type && node.parent !== null && parents.includes(node.parent.type)
}

function targetName(rule: AstRule, language?: string) {
  const target = rule.target ?? ''
  return rule.label || astNodeLabel(target, language) || '指定语法'
}

function countPhrase(verb: string, rule: AstRule) {
  if (rule.exact !== undefined) return `${verb} ${rule.exact} 次`
  if (rule.min !== undefined && rule.max !== undefined) return `${verb} ${rule.min}～${rule.max} 次`
  if (rule.min !== undefined) return `至少${verb} ${rule.min} 次`
  if (rule.max !== undefined) return `至多${verb} ${rule.max} 次`
  return ''
}

/**
 * 一条规则的中文描述。判题结果（statistic_info.ast_results）和题目页的「要求」
 * 用的是同一份 —— 原来前端 ProblemContent.vue 里另有一份几乎一样的实现，
 * 只有 min/max 同时给出时的措辞不一样（生产库里没有这种规则）。
 */
export function describeAstRule(rule: AstRule, language?: string): string {
  if (rule.message) return rule.message
  const name = targetName(rule, language)
  const target = rule.target ?? ''
  switch (rule.engine) {
    case 'must_exist_node':
      return `必须使用 ${name}`
    case 'must_not_exist_node':
      return `不能使用 ${name}`
    case 'count_node':
      return `${name} ${countPhrase('出现', rule)}`.trim()
    case 'must_call_function':
      return `必须调用 ${target}()`
    case 'must_not_call_function':
      return `不能调用 ${target}()`
    case 'count_function_call':
      return `${target}() ${countPhrase('调用', rule)}`.trim()
    case 'must_call_method':
      return `必须调用 .${target}()`
    case 'must_not_call_method':
      return `不能调用 .${target}()`
    case 'must_use_operator':
      return `必须使用 ${astOperatorLabel(target, language)} 运算符`
    case 'must_use_keyword':
      return `调用 ${target}() 时必须用 ${rule.keyword ?? ''} 参数`
    case 'must_have_nesting': {
      // 这两个走 astNodeLabel 而不是裸值 —— 少了这一步文案就是
      // 「必须使用 for_loop 嵌套」，旧栈 ast_checker/engines/nesting.py 是翻的
      const outer = astNodeLabel(rule.outer ?? '', language)
      const inner = astNodeLabel(rule.inner ?? '', language)
      return outer === inner ? `必须使用 ${outer} 嵌套` : `必须在 ${outer} 中嵌套使用 ${inner}`
    }
  }
}

/** 标签配色用的粗分类，见契约 astRequirementSchema */
function requirementKind(engine: AstRule['engine']): AstRequirement['kind'] {
  if (engine.startsWith('must_not')) return 'forbid'
  if (engine.startsWith('count')) return 'count'
  return 'require'
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
  const grouped = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  if (!grouped) return null
  const out: AstRequirements = {}
  for (const [language, rules] of Object.entries(grouped)) {
    if (!Array.isArray(rules)) continue
    if (!AST_SUPPORTED_LANGUAGES.includes(language)) continue
    const items = rules.flatMap((rule) => {
      const parsed = astRuleSchema.safeParse(rule)
      if (!parsed.success) return []
      if (!astRuleIsMeaningful(parsed.data)) return []
      return [
        {
          description: describeAstRule(parsed.data, language),
          kind: requirementKind(parsed.data.engine),
        },
      ]
    })
    if (items.length > 0) out[language] = items
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * AST 规则的语义校验。zod 只管形状（engine 在枚举里、min 是整数），管不了
 * 「给 C 题选了只有 Python 才有的 list_comprehension」这类组合 —— 那种规则存得进去，
 * 判题时 astTargetNodeType() 找不到就回落成裸名去比节点类型，永远失败或永远通过，
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
      return `代码规则暂不支持 ${language}，判题机只检查 ${AST_SUPPORTED_LANGUAGES.join(' / ')}`
    }
    const nodes = AST_NODE_TARGETS_BY_LANGUAGE[language] ?? {}
    const operators = AST_OPERATOR_TARGETS_BY_LANGUAGE[language] ?? {}
    for (const [index, rule] of rules.entries()) {
      const at = `代码规则 ${language} 第 ${index + 1} 条`
      const target = rule.target ?? ''
      if (rule.engine.endsWith('_node')) {
        if (!(target in nodes)) return `${at}：${language} 没有「${target}」这种语法`
      } else if (rule.engine === 'must_use_operator') {
        if (!(target in operators)) return `${at}：${language} 没有「${target}」运算符`
      } else if (rule.engine === 'must_have_nesting') {
        for (const value of [rule.outer ?? '', rule.inner ?? '']) {
          if (!(value in nodes)) return `${at}：${language} 没有「${value}」这种语法`
        }
      } else if (!target.trim()) {
        return `${at}：要检查的函数名/方法名不能为空`
      } else if (rule.engine === 'must_use_keyword') {
        if (language !== 'Python') return `${at}：${language} 没有关键字参数`
        if (!rule.keyword?.trim()) return `${at}：参数名不能为空`
      }
      if (!astRuleIsMeaningful(rule)) return `${at}：次数检查至少要填一个数字`
      if ([rule.exact, rule.min, rule.max].some((n) => n !== undefined && n < 0)) return `${at}：次数不能是负数`
      if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
        return `${at}：至少 ${rule.min} 次比至多 ${rule.max} 次还多，怎么写都过不了`
      }
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
  C: 'call_expression',
  'C++': 'call_expression',
  Python: 'call',
}

/** `import math` / `import numpy as np` 引进来的模块名。`import os.path` 绑定的是 `os` */
function importedModules(root: Node) {
  const names = new Set<string>()
  for (const statement of collectNodes(root, ofType('import_statement'))) {
    for (const item of statement.namedChildren) {
      const name = item.type === 'aliased_import' ? item.childForFieldName('alias') : item.type === 'dotted_name' ? item.namedChildren[0] : null
      if (name) names.add(name.text)
    }
  }
  return names
}

function functionCalls(root: Node, target: string, language: string) {
  const callType = CALL_NODE_TYPES[language] ?? 'call'
  // Python 的 `math.sqrt(4)` 也算调用了 sqrt() —— 和 `from math import sqrt` 后写 `sqrt(4)`
  // 是一回事，老师配「必须调用 sqrt()」时想的就是它。只认 import 进来的模块，
  // `s.count()` 这种对象上的方法还是归「调用方法」
  const modules = language === 'Python' ? importedModules(root) : null
  return collectNodes(root, ofType(callType)).filter((call) => {
    const fn = call.childForFieldName('function')
    if (!fn) return false
    if (fn.type === 'identifier') return fn.text === target
    if (modules && fn.type === 'attribute') {
      const object = fn.childForFieldName('object')
      return object?.type === 'identifier' && modules.has(object.text) && fn.childForFieldName('attribute')?.text === target
    }
    // `std::sort(...)` 是 qualified_identifier。学生写 sort 还是 std::sort 取决于
    // 有没有 using namespace std，两种都得认，所以末段也比一次
    if (language === 'C++' && fn.type === 'qualified_identifier') {
      return fn.text === target || fn.text.split('::').pop() === target
    }
    return false
  })
}

/** 带了 `keyword=...` 的那些 target() 调用。`**kwargs` 展开的不算，看不出里面有没有 */
function keywordCalls(root: Node, target: string, keyword: string, language: string) {
  return functionCalls(root, target, language).filter((call) =>
    call.childForFieldName('arguments')?.namedChildren.some((arg) => arg.type === 'keyword_argument' && arg.childForFieldName('name')?.text === keyword),
  )
}

function methodCalls(root: Node, target: string, language: string) {
  // C++ 的 `a.push_back()` / `p->push_back()` 都是 call_expression + field_expression，
  // 和 Python 的 attribute 不是一回事 —— 少了这个分支，C++ 的「必须调用 .push_back()」
  // 会静默地永远失败
  if (language === 'C++') {
    return collectNodes(root, ofType('call_expression')).filter((call) => {
      const fn = call.childForFieldName('function')
      return fn?.type === 'field_expression' && fn.childForFieldName('field')?.text === target
    })
  }
  if (language !== 'Python') return []
  return collectNodes(root, ofType('call')).filter((call) => {
    const fn = call.childForFieldName('function')
    return fn?.type === 'attribute' && fn.childForFieldName('attribute')?.text === target
  })
}

function evaluateRule(root: Node, rule: AstRule, language: string): AstResult | null {
  const target = rule.target ?? ''
  const match = rule.engine === 'must_use_operator' ? operatorMatch(target, language) : nodeMatch(target, language)

  switch (rule.engine) {
    case 'must_exist_node':
      return {
        description: describeAstRule(rule, language),
        passed: hasNode(root, match),
      }
    case 'must_not_exist_node': {
      const nodes = collectNodes(root, match)
      return withLines({ description: describeAstRule(rule, language), passed: nodes.length === 0 }, nodes)
    }
    case 'count_node': {
      const nodes = collectNodes(root, match)
      return withLines(
        {
          description: describeAstRule(rule, language),
          passed: rangePassed(nodes.length, rule),
          actual: nodes.length,
        },
        // 次数太少时没有「哪几行」可标
        rule.max !== undefined || rule.exact !== undefined ? nodes : [],
      )
    }
    case 'must_call_function':
      return {
        description: describeAstRule(rule, language),
        passed: functionCalls(root, target, language).length > 0,
      }
    case 'must_not_call_function': {
      const calls = functionCalls(root, target, language)
      return withLines({ description: describeAstRule(rule, language), passed: calls.length === 0 }, calls)
    }
    case 'count_function_call': {
      const calls = functionCalls(root, target, language)
      return withLines(
        {
          description: describeAstRule(rule, language),
          passed: rangePassed(calls.length, rule),
          actual: calls.length,
        },
        rule.max !== undefined || rule.exact !== undefined ? calls : [],
      )
    }
    case 'must_call_method':
      return {
        description: describeAstRule(rule, language),
        passed: methodCalls(root, target, language).length > 0,
      }
    case 'must_not_call_method': {
      const calls = methodCalls(root, target, language)
      return withLines({ description: describeAstRule(rule, language), passed: calls.length === 0 }, calls)
    }
    case 'must_use_operator':
      return {
        description: describeAstRule(rule, language),
        passed: hasNode(root, match),
      }
    case 'must_use_keyword':
      return {
        description: describeAstRule(rule, language),
        passed: keywordCalls(root, target, rule.keyword ?? '', language).length > 0,
      }
    case 'must_have_nesting': {
      const outer = rule.outer ?? ''
      const inner = rule.inner ?? ''
      const innerMatch = nodeMatch(inner, language)
      const passed = collectNodes(root, nodeMatch(outer, language)).some((node) => node.children.some((child) => hasNode(child, innerMatch)))
      return { description: describeAstRule(rule, language), passed }
    }
    default:
      return null
  }
}

export async function checkAst(code: string, language: string, rules: AstRule[]): Promise<{ passed: boolean; results: AstResult[] }> {
  if (rules.length === 0) return { passed: true, results: [] }

  const treeSitterLanguage = await loadLanguage(language)
  if (!treeSitterLanguage) return { passed: true, results: [] }

  const parser = new Parser()
  try {
    parser.setLanguage(treeSitterLanguage)
    const tree = parser.parse(code)
    if (!tree) return { passed: true, results: [] }
    try {
      const results = rules
        .filter(astRuleIsMeaningful)
        .map((rule) => evaluateRule(tree.rootNode, rule, language))
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

/**
 * 一份代码对着几组规则各判一遍，只解析一次。挑战用：一道题几条挑战各是一组，补历史记录时
 * 一份代码要判全部挑战，每组 checkAst 一次就是把同一份代码解析好几遍。
 *
 * 和 checkAst 不同，**判不了时返回 null 而不是「通过」**：checkAst 是题目的硬要求，
 * 判不了就放行、别冤枉学生；挑战判不了就是没做到，放行等于白送。
 */
export async function checkAstGroups(code: string, language: string, groups: AstRule[][]): Promise<{ passed: boolean; results: AstResult[] }[] | null> {
  const treeSitterLanguage = await loadLanguage(language)
  if (!treeSitterLanguage) return null
  const parser = new Parser()
  try {
    parser.setLanguage(treeSitterLanguage)
    const tree = parser.parse(code)
    if (!tree) return null
    try {
      return groups.map((rules) => {
        const results = rules
          .filter(astRuleIsMeaningful)
          .map((rule) => evaluateRule(tree.rootNode, rule, language))
          .filter((result): result is AstResult => result !== null)
        return { passed: results.length > 0 && results.every((r) => r.passed), results }
      })
    } finally {
      tree.delete()
    }
  } catch {
    return null
  } finally {
    parser.delete()
  }
}
