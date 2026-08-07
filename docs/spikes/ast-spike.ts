import { Language, Parser } from "web-tree-sitter"

// 复刻 ast_checker 的 C_MAPPING 片段
const C_MAPPING: Record<string, string> = {
  for_loop: "for_statement",
  while_loop: "while_statement",
  function_definition: "function_definition",
  include: "preproc_include",
}

await Parser.init()

const parser = new Parser()
const cLang = await Language.load("./node_modules/tree-sitter-c/tree-sitter-c.wasm")
parser.setLanguage(cLang)

const code = `#include <stdio.h>
int main() {
    int sum = 0;
    for (int i = 1; i <= 100; i++) {
        sum += i;
    }
    printf("%d\\n", sum);
    return 0;
}`

const t0 = performance.now()
const tree = parser.parse(code)!
const parseMs = performance.now() - t0

// 数各类节点出现次数（等价于 ast_checker 的 engine.check 遍历）
const counts: Record<string, number> = {}
const walk = (n: any) => {
  counts[n.type] = (counts[n.type] ?? 0) + 1
  for (let i = 0; i < n.childCount; i++) walk(n.child(i))
}
walk(tree.rootNode)

console.log("解析耗时:", parseMs.toFixed(2), "ms")
for (const [label, tsType] of Object.entries(C_MAPPING)) {
  console.log(`  规则 ${label.padEnd(20)} -> ${tsType.padEnd(20)} 命中 ${counts[tsType] ?? 0}`)
}

// Python grammar 也验一下
const pyParser = new Parser()
pyParser.setLanguage(await Language.load("./node_modules/tree-sitter-python/tree-sitter-python.wasm"))
const pyTree = pyParser.parse("for i in range(10):\n    print(i)")!
console.log("\nPython 根节点:", pyTree.rootNode.type, "| 首个子节点:", pyTree.rootNode.child(0)?.type)
