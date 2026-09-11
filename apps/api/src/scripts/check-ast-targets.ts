/**
 * 检查契约里每个 AST target 的 `node` 在对应语言的语法里真实存在。
 *
 *   bun run --filter '@oj2/api' check:ast
 *
 * ## 为什么需要这个
 *
 * 判题机拿 `node` 去比 tree-sitter 的节点类型，**对不上不会报错**：collectNodes
 * 一个都收不到，于是「必须使用 X」永远失败、「不能使用 X」永远通过。两头都不报错，
 * 只有学生受着 —— 他明明写了 f-string，「不能使用 f-string」却judge成通过。
 *
 * 这正是本仓库真实踩过的坑：`f_string` 一直配的是 `format_string`，而这个版本的
 * tree-sitter-python 里根本没有这种节点（f-string 是 `string` 里带 `interpolation`），
 * 所以那条规则从上线起就没生效过。加这个检查那天，56 个 target 里就它一个是坏的。
 *
 * 升级 tree-sitter-* 依赖之后一定要跑一次：语法改个节点名是很常见的事，
 * 而它造成的故障完全静默。
 *
 * 只验节点类型**存在**，不验语义对不对（比如把 `while_loop` 配成 `for_statement`
 * 这种，语法里两个都存在，机器看不出来）。语义那一层还是得靠实跑。
 */

import { AST_NODE_TARGETS_BY_LANGUAGE } from "@oj2/contract"
import { Language, Parser } from "web-tree-sitter"

import cWasmPath from "tree-sitter-c/tree-sitter-c.wasm" with { type: "file" }
import cppWasmPath from "tree-sitter-cpp/tree-sitter-cpp.wasm" with { type: "file" }
import pythonWasmPath from "tree-sitter-python/tree-sitter-python.wasm" with { type: "file" }
import treeSitterWasmPath from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" }

const WASM_BY_LANGUAGE: Record<string, string> = {
  C: cWasmPath,
  "C++": cppWasmPath,
  Python3: pythonWasmPath,
}

await Parser.init({ locateFile: () => treeSitterWasmPath })

let checked = 0
const missing: Array<{ language: string; target: string; node: string }> = []

for (const [language, table] of Object.entries(AST_NODE_TARGETS_BY_LANGUAGE)) {
  const wasmPath = WASM_BY_LANGUAGE[language]
  if (!wasmPath) {
    console.log(`⚠ ${language} 在 AST_NODE_TARGETS_BY_LANGUAGE 里，但这个脚本没有它的语法 wasm`)
    console.log(`   加语言时记得同步 WASM_BY_LANGUAGE 和 judge/ast.ts 的 loadLanguage`)
    process.exit(2)
  }
  const loaded = await Language.load(wasmPath)
  // 语法里声明过的全部节点类型名
  const declared = new Set<string>()
  for (let id = 0; id < loaded.nodeTypeCount; id++) {
    const name = loaded.nodeTypeForId(id)
    if (name) declared.add(name)
  }
  for (const [target, entry] of Object.entries(table)) {
    checked++
    if (!declared.has(entry.node)) missing.push({ language, target, node: entry.node })
  }
}

console.log(`检查了 ${checked} 个 AST target 的节点类型`)
if (missing.length === 0) {
  console.log("✓ 每个 target 的 node 都在对应语言的语法里真实存在")
  process.exit(0)
}
for (const { language, target, node } of missing) {
  console.log(`\n⚠ ${language} 的 ${target} → "${node}"`)
  console.log(`   这个节点类型在语法里不存在，规则永远失败（或永远通过），且不报错`)
  console.log(`   改法：在 packages/contract/src/problem.ts 把它的 node 改成语法里真实的名字`)
}
process.exit(1)
