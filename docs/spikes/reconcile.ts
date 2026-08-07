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

const md = [
  "# 端点清单（机器初判）",
  "",
  `生成时间：${new Date().toISOString().slice(0, 10)}`,
  `合计 ${rows.length} 个端点 —— KEEP ${count("KEEP")}、CUT ${count("CUT")}、REVIEW ${count("REVIEW")}`,
  "",
  "> REVIEW 项需人工裁决，裁决后把本行的 REVIEW 改成 KEEP 或 CUT，并在末列写明理由。",
  "",
  "> 已知盲点 1：`ojnext/src/oj/api.ts` 第 45、73 行用变量动态传路径（形如 `http.get(endpoint)`），提取脚本的正则匹配不到这类调用。因此对应的后端端点会被本表判成“前端无调用”，但实际可能仍在使用 —— 例如 `/api/contest_submissions`（`getSubmissions` 里 `endpoint` 变量的另一分支）。",
  "",
  "> 已知盲点 2：`ojnext` 里有 4 处用原生 `fetch(\"/api/...\")` 而非 `http.get/post(...)` 发起请求（AI 流式响应场景：`src/oj/store/ai.ts`、`src/oj/problem/components/SubmissionResult.vue`、`src/oj/rank/list.vue`、`src/oj/class/pk.vue`），提取脚本只认 `get/post/put/delete(...)` 调用形式，完全抓不到 `fetch(...)`。本轮 REVIEW 里的 `/api/ai/analysis`、`/api/ai/hint`、`/api/ai/class_pk`、`/api/ai/class_single` 经人工核实均属此类，实际都在用。",
  "",
  "> 上述两类盲点都是“前端有调用=否”但实际有调用，人工裁决时不要仅凭本表这一列就判 CUT；REVIEW 里唯一不属于此类的是 `/api/judge_server_heartbeat/`——它是判题机而非前端调用的接口，不受提取脚本盲点影响，是否保留需按后端间调用来判断。",
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
