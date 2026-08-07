# 阶段 0：存量盘点与做减法 —— 实施计划

> **给执行者：** 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实施。步骤用 `- [ ]` 复选框跟踪。

**目标：** 产出一张经人工裁决的端点清单，明确新后端要实现哪些、砍掉哪些；并取回数据库 schema dump 以解除阶段 1 的阻塞。

**架构：** 纯静态分析 + 人工裁决，不修改任何现有代码。分别从 Django `urls/*.py` 与 ojnext 的 `api.ts` 提取端点全集与调用全集，机器对账产出三态清单（保留 / 砍掉 / 待裁决），待裁决项由人决定。全部脚本落在 `OJ2/docs/spikes/`，产物落在 `OJ2/docs/specs/`。

**技术栈：** Bun 1.3.11、TypeScript。无需数据库、无需 Docker、无需 Python 环境。

## 全局约束

- **不修改 `OnlineJudge/` 和 `ojnext/` 任何文件。** 两个旧仓库全程冻结，回滚路径依赖于此。阶段 0 的"砍"是决策层面的，产物是清单不是 diff。
- **不写测试。** 项目既定策略（根 `CLAUDE.md`：Do not write new tests）。本计划用"跑脚本核对输出数字"替代测试环节。
- **本机无 PostgreSQL / Redis / Docker。** 任何需要数据库连接的操作只能在服务器上做。
- 后端端点 ground truth：**127 个（oj 77 / admin 50）**，其中 **17 个**已由人工标注 `# DEPRECATED: 前端未调用`。任何提取脚本的输出必须与这两个数字吻合，不吻合就是脚本有 bug。

  > **这两个数字不是提取脚本自己产出的**，否则自检就退化成"脚本必须复现自己的 bug"——本计划初稿写的 122 / 74 / 48 / 16 正是这么来的，脚本漏抓了 `tutorial/urls/tutorial.py` 与 `utils/urls.py` 两个文件共 5 个端点，ground truth 跟着一起错。
  >
  > 独立核验方式（不经过任何提取脚本）：
  >
  > ```bash
  > cd /home/xuyue/Projects/OJ/OnlineJudge
  > cat */urls/*.py utils/urls.py | grep -c "path("   # → 127
  > ```
  >
  > oj/admin 的拆分靠与 `OnlineJudge/oj/urls.py` 的 include 清单逐条对齐核验：该文件共 26 条 `include(...)`，挂载前缀 `api/` 的归 oj、`api/admin/` 的归 admin，把每条 include 指向的文件的 `path(` 计数按前缀分别累加 → oj 77、admin 50。注意其中两条不符合"`<app>/urls/{oj,admin}.py`"的命名惯例：`tutorial.urls.tutorial`（目录里但文件名不叫 oj）与 `utils.urls`（模块文件，没有 `urls/` 目录）。**提取器必须以 `oj/urls.py` 为唯一入口，不得按文件名白名单猜。**

- 前端调用路径基线：**148 条 `method + path` / 104 条不同路径**（含模板字符串，`${...}` 归一化为 `:param`）。计划初稿写的 78 是只数字面量、不含模板串和泛型 `get<T>(...)` 的旧口径，已作废。
- 反向对账基线：前端调用路径全部能在后端端点全集里找到对应，**orphan 应为 0**。非 0 说明提取器又漏了 urls 文件，或前端有调用死路径的代码。
- 工作目录统一为 `OJ2/docs/spikes/`，脚本用绝对路径接收 `OnlineJudge` / `ojnext` 位置。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `docs/spikes/extract-endpoints.ts` | **已完成。** 从 Django `urls/*.py` 提取后端端点全集 → `endpoints-backend.json` |
| `docs/spikes/extract-frontend-calls.ts` | 从 ojnext 提取前端调用全集 → `endpoints-frontend.json` |
| `docs/spikes/reconcile.ts` | 对账两份 JSON，产出三态清单 → `endpoint-inventory.md` |
| `docs/spikes/jieba-spike.ts` | 验证 `@node-rs/jieba` 在 Bun 下可用 |
| `docs/specs/endpoint-inventory.md` | **本阶段主产物**：经人工裁决的端点清单 |
| `docs/specs/schema.sql` | 从服务器取回的 schema-only dump，供阶段 1 使用 |

---

## Task 1: 后端端点提取器

**状态：已完成**（写计划过程中一并做掉了，代码已在仓库）

**Files:**
- Created: `docs/spikes/extract-endpoints.ts`

**Interfaces:**
- Produces: `endpoints-backend.json`，元素形如
  ```ts
  type Endpoint = {
    app: string        // "problem"
    side: "oj" | "admin"
    pattern: string    // "/api/problem/"
    view: string       // "ProblemAPI"
    name: string       // "problem_api"，无则空串
    deprecated: boolean // 是否已标 # DEPRECATED
  }
  ```

实现中踩过的四个坑，改脚本时别踩回去：
1. 18 处 `path(` 参数换行写，按行扫会漏 → 用括号深度扫描找完整片段。
2. 行尾注释在 `.as_view()` 的右括号之后，切片到第一个 `)` 会截断 → 片段要延伸到该行行尾。
3. 注释可能出现在 `path(` 后、字符串后、逗号后任意位置 → 匹配前先 `replace(/#[^\n]*/g, "")` 剥掉，判 `DEPRECATED` 时仍用原文。
4. **不要按文件名白名单（`oj.py` / `admin.py`）扫 `<app>/urls/` 目录。** 初版这么写，静默漏掉 5 个端点（其中 4 个前端在用）：`tutorial/urls/tutorial.py` 文件名不在白名单里，`utils/urls.py` 根本没有 `urls/` 目录、被 `statSync` 的 catch 直接吞掉。改为解析 `OnlineJudge/oj/urls.py` 的 26 条 `include(...)`，`side` 与路径前缀直接取挂载前缀，`app` 取 Python 模块名首段（不能用目录层数推，`utils.urls` 只有两段）。

- [ ] **Step 1: 确认脚本输出与 ground truth 一致**

```bash
cd /home/xuyue/Projects/OJ/OJ2/docs/spikes
bun run extract-endpoints.ts /home/xuyue/Projects/OJ/OnlineJudge
```

预期输出，三个数字必须完全一致：
```
挂载点 26 个（来自 oj/urls.py 的 include）
后端端点合计 127  (oj 77 / admin 50)
其中已标 DEPRECATED: 17
→ endpoints-backend.json
```

---

## Task 2: 前端调用提取器

**Files:**
- Create: `docs/spikes/extract-frontend-calls.ts`

**Interfaces:**
- Consumes: 无
- Produces: `endpoints-frontend.json`，元素形如
  ```ts
  type Call = {
    file: string      // "src/oj/api.ts"
    fn: string        // 所属导出函数名，取不到则空串
    method: string    // "get" | "post" | "put" | "delete"
    path: string      // "problem" 或 "problem/${id}" → 归一化为 "problem/:param"
  }
  ```

前端有两种写法都要覆盖：字面量 `get("problem")` 和模板串 `` get(`problem/${id}`) ``。模板串里的 `${...}` 统一归一化成 `:param`，否则无法与后端的 `<int:pk>` 之类对账。

- [ ] **Step 1: 写提取脚本**

```typescript
#!/usr/bin/env bun
// 从 ojnext 提取前端实际发起的 API 调用
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.argv[2] ?? "/home/xuyue/Projects/OJ/ojnext"
const SRC = join(ROOT, "src")

type Call = { file: string; fn: string; method: string; path: string }

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walkFiles(p, out)
    else if (/\.(ts|vue)$/.test(p)) out.push(p)
  }
  return out
}

// 同时吃 get("x") 和 get(`x/${id}`)
const CALL_RE = /\b(get|post|put|delete)\(\s*(["'`])([^"'`]*)\2/g
// 就近向上找所属的导出函数名
const FN_RE = /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=/g

function normalize(p: string): string {
  return p.replace(/\$\{[^}]*\}/g, ":param").replace(/^\/+/, "")
}

const calls: Call[] = []
for (const file of walkFiles(SRC)) {
  const src = readFileSync(file, "utf8")

  // 先建立 "偏移量 -> 函数名" 的索引
  const fns: { at: number; name: string }[] = []
  FN_RE.lastIndex = 0
  let f: RegExpExecArray | null
  while ((f = FN_RE.exec(src)) !== null) fns.push({ at: f.index, name: f[1] ?? f[2] })

  CALL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CALL_RE.exec(src)) !== null) {
    const path = normalize(m[3])
    if (!path || path.startsWith("http")) continue // 跳过外部 URL 和空串
    const owner = fns.filter((x) => x.at < m!.index).pop()
    calls.push({
      file: relative(ROOT, file),
      fn: owner?.name ?? "",
      method: m[1],
      path,
    })
  }
}

const uniq = new Set(calls.map((c) => `${c.method} ${c.path}`))
console.log(`前端调用点 ${calls.length} 处，去重后 ${uniq.size} 条`)
await Bun.write("endpoints-frontend.json", JSON.stringify(calls, null, 2))
console.log("→ endpoints-frontend.json")
```

- [ ] **Step 2: 运行并核对基线**

```bash
cd /home/xuyue/Projects/OJ/OJ2/docs/spikes
bun run extract-frontend-calls.ts /home/xuyue/Projects/OJ/ojnext
```

预期：`前端调用点 154 处，去重后 148 条`（148 是 `method + path` 去重；只按 path 去重是 104 条）。若明显低于此数，说明正则漏了写法，检查 `src/utils/http.ts` 里 http 客户端的实际调用形式再修 —— 泛型 `get<T>("x")` 是重灾区，不吃泛型会漏掉三分之一。

- [ ] **Step 3: 抽查 3 条结果**

```bash
bun -e 'const c=await Bun.file("endpoints-frontend.json").json(); console.log(c.filter(x=>x.path.includes(":param")).slice(0,3))'
```

确认模板串确实被归一化成了 `:param`，且 `fn` 字段能对上 `src/oj/api.ts` 里的实际函数名。

- [ ] **Step 4: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add docs/spikes/extract-frontend-calls.ts
git commit -m "chore(阶段0): 前端 API 调用提取器"
```

---

## Task 3: 对账并产出三态清单

**Files:**
- Create: `docs/spikes/reconcile.ts`
- Create: `docs/specs/endpoint-inventory.md`（脚本生成）

**Interfaces:**
- Consumes: `endpoints-backend.json`（Task 1 的 `Endpoint[]`）、`endpoints-frontend.json`（Task 2 的 `Call[]`）
- Produces: `docs/specs/endpoint-inventory.md`，每个端点落入三态之一：
  - `KEEP` —— 前端有调用，新后端必须实现
  - `CUT` —— 已标 DEPRECATED 且前端确无调用，不实现
  - `REVIEW` —— 机器判不准，需人工裁决（Task 4 处理）

后端 `pattern` 与前端 `path` 无法直接字符串相等：后端是 `/api/problem/`，前端是 `problem`；后端有 `<int:pk>` 之类占位符，前端归一化成了 `:param`。所以要各自降到一个可比的 key。

- [ ] **Step 1: 写对账脚本**

> 下面是初稿。**以仓库里的 `docs/spikes/reconcile.ts` 为准**，它比初稿多两处必要修正：`key()` 不能剥掉 `admin/` 段（初稿的 `(admin\/)?` 分组会把全部 admin 端点误判成 REVIEW），以及新增了反向对账（前端调用了但后端查无此端点）。

```typescript
#!/usr/bin/env bun
// 对账后端端点全集与前端调用全集，产出三态清单
type Endpoint = { app: string; side: "oj" | "admin"; pattern: string; view: string; name: string; deprecated: boolean }
type Call = { file: string; fn: string; method: string; path: string }

const backend: Endpoint[] = await Bun.file("endpoints-backend.json").json()
const frontend: Call[] = await Bun.file("endpoints-frontend.json").json()

// 归一化到可比 key：去掉 /api 前缀、去掉首尾斜杠、占位符统一成 :param、转小写
function key(s: string): string {
  return s
    .replace(/^\/?api\/(admin\/)?/, "")
    .replace(/<[^>]*>/g, ":param")
    .replace(/:param/g, ":param")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase()
}

const feKeys = new Set(frontend.map((c) => key(c.path)))

type Verdict = "KEEP" | "CUT" | "REVIEW"
const rows = backend.map((e) => {
  const k = key(e.pattern)
  const called = feKeys.has(k)
  let verdict: Verdict
  if (called && !e.deprecated) verdict = "KEEP"
  else if (!called && e.deprecated) verdict = "CUT"
  else verdict = "REVIEW" // 标了 DEPRECATED 却有人调，或没标却没人调 —— 两种都要人看
  return { ...e, key: k, called, verdict }
})

const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length
console.log(`KEEP ${count("KEEP")} / CUT ${count("CUT")} / REVIEW ${count("REVIEW")}  合计 ${rows.length}`)

const md = [
  "# 端点清单（机器初判）",
  "",
  `生成时间：${new Date().toISOString().slice(0, 10)}`,
  `合计 ${rows.length} 个端点 —— KEEP ${count("KEEP")}、CUT ${count("CUT")}、REVIEW ${count("REVIEW")}`,
  "",
  "> REVIEW 项需人工裁决，裁决后把本行的 REVIEW 改成 KEEP 或 CUT，并在末列写明理由。",
  "",
  "| 裁决 | app | 侧 | 路径 | 视图 | 前端有调用 | 已标 DEPRECATED | 理由 |",
  "|---|---|---|---|---|---|---|---|",
  ...rows
    .sort((a, b) => a.verdict.localeCompare(b.verdict) || a.app.localeCompare(b.app))
    .map((r) => `| ${r.verdict} | ${r.app} | ${r.side} | \`${r.pattern}\` | ${r.view} | ${r.called ? "是" : "否"} | ${r.deprecated ? "是" : "否"} | |`),
  "",
].join("\n")

await Bun.write("../specs/endpoint-inventory.md", md)
console.log("→ docs/specs/endpoint-inventory.md")
```

- [ ] **Step 2: 运行**

```bash
cd /home/xuyue/Projects/OJ/OJ2/docs/spikes
bun run reconcile.ts
```

预期：`KEEP 104 / CUT 17 / REVIEW 6  合计 127`，且**不出现** `⚠ 前端调用无对应后端端点` 这行反向对账告警。REVIEW 数量若超过 40，说明 `key()` 归一化不够，多半是后端 `pattern` 里还有没处理的占位符写法 —— 先抽查几个 REVIEW 行确认是真需人工判还是归一化没做对。反向告警若非 0，先查提取器是不是又漏了 urls 文件，再考虑是不是前端留了死调用。

- [ ] **Step 3: 抽查归一化质量**

```bash
bun -e 'const r=await Bun.file("endpoints-backend.json").json(); console.log([...new Set(r.map(e=>e.pattern))].filter(p=>/[<>{}]/.test(p)).slice(0,10))'
```

把后端所有含占位符的 pattern 列出来，确认 `key()` 里的 `<[^>]*>` 覆盖了全部写法。如有 `{id}` 之类别的形式，补进正则重跑 Step 2。

- [ ] **Step 4: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add docs/spikes/reconcile.ts docs/specs/endpoint-inventory.md
git commit -m "chore(阶段0): 端点对账脚本与机器初判清单"
```

---

## Task 4: 人工裁决 REVIEW 项

**Files:**
- Modify: `docs/specs/endpoint-inventory.md`

**Interfaces:**
- Consumes: Task 3 产出的清单
- Produces: 同一文件，`REVIEW` 归零，每个端点确定为 `KEEP` 或 `CUT`，末列写明理由

**这一步必须由项目所有者本人做，不能由 agent 代劳。** 机器只知道"前端有没有调用"，不知道"这个功能是不是我打算下学期启用的"。

裁决时的判断顺序：

1. **标了 DEPRECATED 但前端有调用** —— 优先查是不是提取脚本漏了写法，不是脚本问题再判。这类是高风险误砍。
2. **没标 DEPRECATED 且前端无调用** —— 大概率是死代码，但要排除三种例外：被 `admin/` 后台页面以外的方式调用（如直接开浏览器访问）、被外部脚本/定时任务调用、`open_api_appkey` 那种给第三方用的接口。
3. **拿不准的一律判 KEEP。** 阶段 0 的目的是省掉确定不用的工作量，不是极限压缩。误砍一个要在阶段 3 才发现，成本远高于多写一个 CRUD 端点。

- [ ] **Step 1: 逐行裁决**

打开 `docs/specs/endpoint-inventory.md`，把每个 `REVIEW` 改成 `KEEP` 或 `CUT`，末列填理由（一句话即可）。

- [ ] **Step 2: 确认无残留**

```bash
grep -c "| REVIEW |" /home/xuyue/Projects/OJ/OJ2/docs/specs/endpoint-inventory.md
```

预期输出：`0`

- [ ] **Step 3: 记录最终结论**

在文件开头的统计行下面补一句实际结果，例如：
```markdown
**裁决结果：新后端需实现 NN 个端点，砍掉 MM 个（占 XX%）。**
```

- [ ] **Step 4: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add docs/specs/endpoint-inventory.md
git commit -m "docs(阶段0): 端点清单人工裁决完成"
```

---

## Task 5: 验证 @node-rs/jieba

**Files:**
- Create: `docs/spikes/jieba-spike.ts`

**Interfaces:**
- Consumes: 无
- Produces: 结论写入设计文档 7.3 节

设计文档已把这条列为"不构成方案级风险"—— 它只影响 `flowchart/views/admin.py` 一个文件，不通也有纯 JS 兜底。所以验不过不要停下来修，记录结论继续走。

参照物是现有用法（`flowchart/views/admin.py:65,191`）：`jieba.add_word(w, freq=9999)` 加自定义词，然后 `jieba.cut(text)` 切词。新库必须支持这两件事。

- [ ] **Step 1: 装依赖**

```bash
cd /home/xuyue/Projects/OJ/OJ2/docs/spikes
bun add @node-rs/jieba
```

- [ ] **Step 2: 写验证脚本**

```typescript
#!/usr/bin/env bun
// 验证 @node-rs/jieba 能否替代 Python jieba
// 对照 flowchart/views/admin.py:65,191 的用法：add_word + cut
import { Jieba } from "@node-rs/jieba"
import { dict } from "@node-rs/jieba/dict"

const jieba = Jieba.withDict(dict)

const text = "输入两个整数并输出它们的和"
console.log("默认切词:", jieba.cut(text).join(" / "))

// 对应 jieba.add_word(_w, freq=9999)
jieba.insertWord("两个整数")
console.log("加词后  :", jieba.cut(text).join(" / "))

const t0 = performance.now()
for (let i = 0; i < 1000; i++) jieba.cut(text)
console.log("1000 次切词耗时:", (performance.now() - t0).toFixed(0), "ms")
```

- [ ] **Step 3: 运行**

```bash
cd /home/xuyue/Projects/OJ/OJ2/docs/spikes
bun run jieba-spike.ts
```

预期：两行切词结果都能正常输出，且"加词后"的结果里 `两个整数` 不再被拆开。

若 import 失败（NAPI 二进制在 Bun 下加载不了），记录错误信息，改用纯 JS 的 `segmentit` 或 `nodejieba` 再试一次；两个都不行就在设计文档里记"降级为不分词的 LIKE 匹配"，继续下一个任务。

- [ ] **Step 4: 把结论写回设计文档**

编辑 `docs/specs/2026-08-06-bun-backend-rewrite-design.md` 第 7.3 节，把"待验证"改成实测结论（通过 / 不通过 + 采用的方案）。

- [ ] **Step 5: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add docs/spikes/jieba-spike.ts docs/specs/2026-08-06-bun-backend-rewrite-design.md
git commit -m "chore(阶段0): 验证 jieba 替代方案"
```

---

## Task 6: 取回数据库 schema

**Files:**
- Create: `docs/specs/schema.sql`

**Interfaces:**
- Consumes: 无
- Produces: `docs/specs/schema.sql` —— 阶段 1 的 `drizzle-kit pull` 依赖它

**这是阶段 1 的解阻塞前提。** 本机没有 PostgreSQL，`drizzle-kit pull` 连不上库，所以必须先从服务器把 schema 拿下来。只取结构不取数据，文件里不含任何学生信息，可以安全入库。

- [ ] **Step 1: 在服务器上导出**

登录跑着生产库的服务器，执行（容器名以实际 `docker-compose.yml` 为准）：

```bash
docker exec oj-postgres pg_dump -U onlinejudge -d onlinejudge \
  --schema-only --no-owner --no-privileges > schema.sql
```

- [ ] **Step 2: 传回本机**

```bash
scp <服务器>:~/schema.sql /home/xuyue/Projects/OJ/OJ2/docs/specs/schema.sql
```

- [ ] **Step 3: 确认内容干净且完整**

```bash
cd /home/xuyue/Projects/OJ/OJ2/docs/specs
echo "表数量: $(grep -c '^CREATE TABLE' schema.sql)"
echo "含 COPY/INSERT（应为 0）: $(grep -cE '^(COPY|INSERT)' schema.sql)"
grep -oE '^CREATE TABLE [a-z_."]+' schema.sql | sed 's/CREATE TABLE //' | sort
```

预期：
- 表数量约 30+（26 张业务表 + Django 框架表）
- `COPY`/`INSERT` 计数为 **0** —— 非 0 说明误导出了数据，删掉重来
- 表名列表里应能看到 `django_migrations`、`django_content_type`、`django_session`、`auth_permission` 等框架表，它们在阶段 1 会被剪掉

- [ ] **Step 4: 提交**

```bash
cd /home/xuyue/Projects/OJ/OJ2
git add docs/specs/schema.sql
git commit -m "chore(阶段0): 取回生产库 schema，解阻塞阶段 1"
```

---

## 阶段 0 完成标准

四项全部满足才算完成，缺一项都不要进阶段 1：

- [ ] `docs/specs/endpoint-inventory.md` 中 `REVIEW` 计数为 0，每个端点都有 KEEP/CUT 裁决
- [ ] 清单顶部记录了最终数字：新后端需实现 N 个端点
- [ ] jieba 替代方案有明确结论，已写回设计文档 7.3 节
- [ ] `docs/specs/schema.sql` 已入库，`CREATE TABLE` 数量正常且不含数据

---

## 自查记录

**规格覆盖：** 设计文档第 11 节阶段 0 列的三项 —— 端点筛查（Task 1-4）、删除死代码（改为清单决策，见全局约束）、验证 jieba（Task 5）—— 均已覆盖。额外补了 Task 6，因为设计文档第 8 节要求 `drizzle-kit pull`，而本机无数据库，不先取 schema 阶段 1 无法开工。

**与设计文档的两处偏离，均已在上文说明理由：**
1. 阶段 0 不删旧代码，只产出清单 —— 与文档第 5 节"旧仓库全程冻结"保持一致。
2. 不写测试 —— 遵循项目既定策略，用核对输出数字替代。

**类型一致性：** `Endpoint` 类型在 Task 1、Task 3 中定义一致（含 `deprecated: boolean`）；`Call` 类型在 Task 2、Task 3 中定义一致。Task 3 的 `key()` 同时作用于后端 `pattern` 与前端 `path`，归一化规则单点定义。
