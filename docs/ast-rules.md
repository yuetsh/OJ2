# AST 代码规则

规矩在 `CLAUDE.md`「AST 代码规则」一节。这里是加语言、加 target 时要一起看的细节。

## 为什么会有 `check:ast`

契约的 `AST_NODE_TARGETS_BY_LANGUAGE` 是**唯一**一张表，一个 target 一条
`{ label, node }`：`label` 给后台下拉和题目页，`node` 给判题机比 tree-sitter 节点类型。
运算符表 `AST_OPERATOR_TARGETS_BY_LANGUAGE` 一份两用（它的值既是文案又是要比的 token）。
判题机侧没有第二张表，解析统一走契约的 `astTargetNodeType()`，所以**加 target 而漏配节点
类型在结构上不可能**。

但**配错**仍然可能，而且完全静默：节点类型对不上就是一个都收不到，于是「必须使用 X」永远
失败、「不能使用 X」永远通过，两头不报错，只有学生受着。

```bash
bun run --filter '@oj2/api' check:ast     # 每个 target 的 node 在语法里是否真实存在
```

**升级 `tree-sitter-*` 依赖之后一定要跑一次** —— 语法改节点名是常事，后果全静默。
加这个检查那天，56 个 target 里就抓出一个：`f_string` 一直配的是 `format_string`，
而这个版本的 tree-sitter-python 根本没有这种节点（f-string 是 `string` 里带
`interpolation`），所以「不能使用 f-string」从上线起就没生效过。

它只验节点类型**存在**，不验语义对不对（把 `while_loop` 配成 `for_statement` 这种两个都
存在，机器看不出来），语义那层还是得实跑。

## 只有三种语言真的会跑

判题机只认 `AST_SUPPORTED_LANGUAGES`（C / C++ / Python3）。别的语言配了规则一条都不会跑，
所以后台不给它们开 tab，题目页也不把它们的规则展示成「要求」——
**看得见却不检查**比没有更糟。

## C++ 不是「C 加几条」那么简单

C++ 的语法表是「C 的全集 + C++ 独有的几条」，因为 tree-sitter-cpp 继承 tree-sitter-c，
C 那 14 个 target 在 C++ 树里逐个实测通用。但**调用形态两者不同**，加语言时必须一起看：

- `a.push_back()` 和 `p->push_back()` 在 C++ 都是 `call_expression` + `field_expression`，
  不是 Python 的 `attribute`；
- `std::sort(...)` 的 function 是 `qualified_identifier` 而不是 `identifier`，所以
  `functionCalls` 对 C++ 额外比一次 `::` 末段 —— 否则学生写了 `using namespace std` 与否
  会得到不同的判定结果。

## 规则的语义校验为什么不在 zod 上

在 `astRulesError()`，不在 `astRulesSchema` 的 refine 上：那个 schema 同时用于**读**后台
题目详情，在读路径上抛错会让历史脏数据把整个题目详情打不开（同 `docs/contract.md` 那套教训）。

同理，保存前先 `pickAstRules()` 剔除够不着的分组再校验，否则早年配过 C++ 规则的题会把老师
锁死 —— tab 里看不到那组规则，保存却被拦下。
