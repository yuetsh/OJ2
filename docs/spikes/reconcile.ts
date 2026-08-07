#!/usr/bin/env bun
// 对账后端端点全集与前端调用全集，产出三态清单
type Endpoint = { app: string; side: "oj" | "admin"; pattern: string; view: string; name: string; deprecated: boolean }
type Call = { file: string; fn: string; method: string; path: string }

const backend: Endpoint[] = await Bun.file("endpoints-backend.json").json()
const frontend: Call[] = await Bun.file("endpoints-frontend.json").json()

// 归一化到可比 key：去掉 /api 前缀、占位符统一成 :param、去掉首尾斜杠、转小写
//
// 注意：只能去掉 /api 前缀，不能连带去掉 admin/ 段。
// 前端所有 http 调用共用同一个 axios 实例（baseURL: "/api"，见 ojnext/src/utils/http.ts），
// admin 接口是前端代码里手写的字面路径，例如 http.get("admin/dashboard_info")——
// 也就是说前端 path 里的 "admin/" 是真实存在的一段，不是像 "/api" 那样的传输层前缀。
// 后端 pattern 是 "/api/admin/dashboard_info"，去掉 "/api/" 之后应该保留 "admin/dashboard_info"
// 才能跟前端对上；如果连 "admin/" 也一并剥掉（brief 原稿的 `(admin\/)?` 分组），
// 后端 key 变成 "dashboard_info"，前端 key 仍是 "admin/dashboard_info"，永远对不上——
// 会把所有本该 KEEP 的 admin 端点错判成 REVIEW。
function key(s: string): string {
  return s
    .replace(/^\/?api\//, "")
    .replace(/<[^>]*>/g, ":param")
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

// 反向对账：前端调用了、后端却查无此端点。
// 只查"后端端点有没有被前端调用"是单向的，提取器漏抓整个 urls 文件时这一侧毫无反应
// —— 历史上 tutorial/urls/tutorial.py 与 utils/urls.py 共 5 个端点被漏掉，靠人眼评审才发现。
// 加上这条反向差集，同类系统性盲区会由脚本自己报警。
// 残留的 orphan 不一定是 bug：前端可能确实留着调用死路径的代码，那本身就是 Task 4 要清的信息。
const beKeys = new Set(rows.map((r) => r.key))
const orphans = [...new Set(frontend.map((c) => key(c.path)))].filter((k) => !beKeys.has(k)).sort()
if (orphans.length) console.warn(`⚠ 前端调用无对应后端端点 ${orphans.length} 条:`, orphans)

// 生成日期用本地时区。toISOString() 是 UTC，本地 UTC+8 晚间生成会写成前一天，
// 而这份产物要靠生成时间判断是否需要重跑。
const today = new Date().toLocaleDateString("sv-SE")

const md = [
  "# 端点清单（机器初判）",
  "",
  `生成时间：${today}`,
  `合计 ${rows.length} 个端点 —— KEEP ${count("KEEP")}、CUT ${count("CUT")}、REVIEW ${count("REVIEW")}`,
  "",
  "> REVIEW 项需人工裁决，裁决后把本行的 REVIEW 改成 KEEP 或 CUT，并在末列写明理由。",
  "",
  "> 已知盲点 1：`ojnext/src/oj/api.ts` 第 45、73 行用变量动态传路径（形如 `http.get(endpoint)`），提取脚本的正则匹配不到这类调用。因此对应的后端端点会被本表判成“前端无调用”，但实际可能仍在使用 —— 例如 `/api/contest_submissions`（`getSubmissions` 里 `endpoint` 变量的另一分支）。",
  "",
  "> 已知盲点 2：`ojnext` 里有 4 处用原生 `fetch(\"/api/...\")` 而非 `http.get/post(...)` 发起请求（AI 流式响应场景：`src/oj/store/ai.ts`、`src/oj/problem/components/SubmissionResult.vue`、`src/oj/rank/list.vue`、`src/oj/class/pk.vue`），提取脚本只认 `get/post/put/delete(...)` 调用形式，完全抓不到 `fetch(...)`。本轮 REVIEW 里的 `/api/ai/analysis`、`/api/ai/hint`、`/api/ai/class_pk`、`/api/ai/class_single` 经人工核实均属此类，实际都在用。",
  "",
  "> 已知盲点 3：`ojnext/src/utils/download.ts` 是一个独立的 axios 实例（`baseURL: \"/api/admin\"`，与 `src/utils/http.ts` 那个共用实例无关），对外只暴露 `download(url)` 一个函数，内部走 `http.get(url)`。提取脚本既不认 `download(...)` 这种调用名，也抓不到内部那个变量 `url`，所以这条通道上的调用一律是假阴性。当前两个调用点（`src/admin/problem/components/Actions.vue:46`、`src/admin/problem/detail.vue:316`）都指向 `admin/test_case`，而该端点已因别处的字面量调用被判成 KEEP，**本轮结论不受影响**。但日后新增的 `download(...)` 调用会静默变成假阴性 CUT，裁决时留意。",
  "",
  "> 盲点 1、2、3 都是“前端有调用=否”但实际有调用，人工裁决时不要仅凭本表这一列就判 CUT；REVIEW 里唯一不属于此类的是 `/api/judge_server_heartbeat/`——它是判题机而非前端调用的接口，不受提取脚本盲点影响，是否保留需按后端间调用来判断。",
  "",
  `> 反向对账（前端调用了、后端却查无此端点）：${
    orphans.length === 0 ? "**0 条**，前端全部调用路径都能在后端端点全集里找到对应。" : `**${orphans.length} 条**，见下。这类路径要么是提取器又漏了某个 urls 文件，要么是前端留着调用死路径的代码，两种都要查。\n>\n${orphans.map((o) => `> - \`${o}\``).join("\n")}`
  }`,
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
