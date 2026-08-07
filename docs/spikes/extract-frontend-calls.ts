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

// 同时吃 get("x")、get(`x/${id}`)，以及带泛型的 get<T>("x")
// （http.get<T>() 在 api.ts 里大量使用，泛型不吃会漏掉三分之一的调用点）
const CALL_RE = /\b(get|post|put|delete)(?:<[^>]*>)?\(\s*(["'`])([^"'`]*)\2/g
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
