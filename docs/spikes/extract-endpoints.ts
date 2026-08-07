#!/usr/bin/env bun
// 从 Django urls/*.py 提取后端端点全集
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.argv[2] ?? "../../OnlineJudge"

type Endpoint = { app: string; side: "oj" | "admin"; pattern: string; view: string; name: string; deprecated: boolean }

function findUrlFiles(root: string): string[] {
  const out: string[] = []
  for (const app of readdirSync(root)) {
    const dir = join(root, app, "urls")
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    for (const f of readdirSync(dir)) {
      if (f === "oj.py" || f === "admin.py") out.push(join(dir, f))
    }
  }
  return out.sort()
}

// 必须跨行匹配：18 处 path( 的参数换行写，按行扫会漏
//   path("problem/", ProblemAPI.as_view(), name="problem_api"),
//   path(
//       "problemset/visible",
//       ProblemsetVisibleAPI.as_view(),
//   ),
const PATH_RE = /path\(\s*r?["']([^"']*)["']\s*,\s*([A-Za-z_][\w.]*)/g
const NAME_RE = /name\s*=\s*["']([^"']+)["']/

const endpoints: Endpoint[] = []
for (const file of findUrlFiles(ROOT)) {
  const parts = file.split("/")
  const app = parts[parts.length - 3]
  const side = parts[parts.length - 1] === "oj.py" ? "oj" : "admin"
  const src = readFileSync(file, "utf8")
  const prefix = side === "oj" ? "/api/" : "/api/admin/"

  // 按括号深度找出每个 path(...) 的完整片段，再连同该行剩余部分（行尾注释可能带
  // DEPRECATED 标记）一起分析。单纯用正则切片会在 .as_view() 的右括号处截断。
  for (let i = src.indexOf("path("); i !== -1; i = src.indexOf("path(", i + 1)) {
    if (i > 0 && /[\w.]/.test(src[i - 1])) continue // 跳过 re_path( 等
    let depth = 0
    let end = i
    for (let j = i + 4; j < src.length; j++) {
      if (src[j] === "(") depth++
      else if (src[j] === ")" && --depth === 0) {
        end = j + 1
        break
      }
    }
    const lineEnd = src.indexOf("\n", end)
    const chunk = src.slice(i, lineEnd === -1 ? end : lineEnd)

    // 注释可能出现在 path( 之后、字符串之后、逗号之后的任意位置，先整体剥掉再匹配；
    // DEPRECATED 的判定仍用未剥离的 chunk。
    const stripped = chunk.replace(/#[^\n]*/g, "")
    PATH_RE.lastIndex = 0
    const m = PATH_RE.exec(stripped)
    if (!m) {
      console.warn(`  ⚠ 无法解析: ${chunk.split("\n")[0].trim()}`)
      continue
    }
    endpoints.push({
      app,
      side,
      pattern: prefix + m[1],
      view: m[2],
      name: chunk.match(NAME_RE)?.[1] ?? "",
      deprecated: /DEPRECATED/.test(chunk),
    })
  }
}

const oj = endpoints.filter((e) => e.side === "oj").length
const dep = endpoints.filter((e) => e.deprecated).length
console.log(`后端端点合计 ${endpoints.length}  (oj ${oj} / admin ${endpoints.length - oj})`)
console.log(`其中已标 DEPRECATED: ${dep}`)
await Bun.write("endpoints-backend.json", JSON.stringify(endpoints, null, 2))
console.log("→ endpoints-backend.json")
