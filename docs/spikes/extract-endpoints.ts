#!/usr/bin/env bun
// 从 Django urls/*.py 提取后端端点全集
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.argv[2] ?? "../../OnlineJudge"

type Endpoint = { app: string; side: "oj" | "admin"; pattern: string; view: string; name: string; deprecated: boolean }

// 唯一入口是 oj/urls.py —— 它才是 Django 真实的挂载表。
//
// 不要按文件名白名单（oj.py / admin.py）去猜 urls 文件：那样会漏掉两类真实存在的形态，
//   1. urls/ 目录里文件名不叫 oj/admin 的，如 tutorial/urls/tutorial.py（3 个端点，前端在用）
//   2. 根本没有 urls/ 目录、直接是模块文件的，如 utils/urls.py（2 个端点，其一前端在用）
// 历史上这两类共 5 个端点被静默漏掉，其中 4 个前端在用。
// 现在改为解析 oj/urls.py 的 include 清单，挂载前缀直接取自这里，不再从文件名反推 side。
const INCLUDE_RE = /path\(\s*["'](api\/(?:admin\/)?)["']\s*,\s*include\(\s*["']([\w.]+)["']\s*\)/g

type Mount = { prefix: string; module: string; file: string; app: string; side: "oj" | "admin" }

function findMounts(root: string): Mount[] {
  const src = readFileSync(join(root, "oj", "urls.py"), "utf8")
  const mounts: Mount[] = []
  INCLUDE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INCLUDE_RE.exec(src)) !== null) {
    const prefix = m[1]
    const mod = m[2]
    // Python 模块名 → 文件路径。"tutorial.urls.tutorial" → tutorial/urls/tutorial.py，
    // "utils.urls" → utils/urls.py。app 一律取模块名首段，不依赖目录层数。
    mounts.push({
      prefix,
      module: mod,
      file: join(root, ...mod.split(".")) + ".py",
      app: mod.split(".")[0],
      side: prefix === "api/admin/" ? "admin" : "oj",
    })
  }
  return mounts
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
const mounts = findMounts(ROOT)
for (const { file, app, side, prefix } of mounts) {
  const src = readFileSync(file, "utf8")

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
      pattern: "/" + prefix + m[1],
      view: m[2],
      name: chunk.match(NAME_RE)?.[1] ?? "",
      deprecated: /DEPRECATED/.test(chunk),
    })
  }
}

const oj = endpoints.filter((e) => e.side === "oj").length
const dep = endpoints.filter((e) => e.deprecated).length
console.log(`挂载点 ${mounts.length} 个（来自 oj/urls.py 的 include）`)
console.log(`后端端点合计 ${endpoints.length}  (oj ${oj} / admin ${endpoints.length - oj})`)
console.log(`其中已标 DEPRECATED: ${dep}`)
await Bun.write("endpoints-backend.json", JSON.stringify(endpoints, null, 2))
console.log("→ endpoints-backend.json")
