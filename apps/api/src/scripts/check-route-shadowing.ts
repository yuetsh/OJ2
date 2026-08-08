/**
 * 检查有没有路由被先注册的同形路由「吃掉」。
 *
 *   bun run --filter '@oj2/api' check:routes
 *
 * ## 为什么需要这个
 *
 * **Hono 按注册顺序匹配，不是静态优先**（已实测确认，别凭直觉假设）。所以
 *
 *     problemRoutes.get("/problems/:id", …)      // 先注册
 *     problemRoutes.get("/problems/random", …)   // 永远进不去
 *
 * 第二条不会报错、不会警告，只是静默走进第一条的 handler，然后因为 "random"
 * 不是合法 id 而返回 404 或者一堆看不懂的结果。阶段 4 真实发生过一次：
 * 两个教师用的分析端点被 `/problems/:id` 吃掉，评审时才发现。
 *
 * 加路由时顺手跑一下，比事后靠人眼在 200 多条路由里看出顺序问题可靠。
 *
 * 局限：靠正则读源码，只认 `xxxRoutes.get("字面量", …)` 这种写法。
 * 动态拼出来的路径看不见 —— 但本仓库没有那种写法，加的时候请保持。
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const SRC = resolve(import.meta.dir, "..")

interface Route {
  method: string
  path: string
  file: string
}

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (entry.endsWith(".ts")) out.push(path)
  }
  return out
}

/** 先注册的 pattern 会不会把后注册的 target 吃掉 */
export function shadows(pattern: string, target: string) {
  const a = pattern.split("/").filter(Boolean)
  const b = target.split("/").filter(Boolean)
  if (a.length !== b.length) return false
  let usedParam = false
  for (let i = 0; i < a.length; i++) {
    const seg = a[i]!
    const other = b[i]!
    if (seg.startsWith(":")) {
      // 参数段吃得掉任何字面量段；两边都是参数说明本来就是同一条，不算遮蔽
      if (other.startsWith(":")) continue
      usedParam = true
      continue
    }
    if (seg !== other) return false
  }
  return usedParam
}

function collect(): Route[] {
  const routerFile = new Map<string, string>()
  for (const file of walk(SRC)) {
    for (const m of readFileSync(file, "utf8").matchAll(/export const (\w+) = new Hono/g)) {
      routerFile.set(m[1]!, file)
    }
  }

  const routesOf = (router: string, prefix: string): Route[] => {
    const file = routerFile.get(router)
    if (!file) return []
    const text = readFileSync(file, "utf8")
    const pattern = new RegExp(`${router}\\.(get|post|put|delete|patch)\\(\\s*"([^"]+)"`, "g")
    return [...text.matchAll(pattern)].map((m) => ({
      method: m[1]!.toUpperCase(),
      path: (prefix + m[2]!).replace(/\/+/g, "/").replace(/\/$/, "") || "/",
      file: file.replace(SRC + "/", ""),
    }))
  }

  // 挂载顺序就是匹配顺序，所以必须按 index.ts 里出现的先后来摊平
  const index = readFileSync(join(SRC, "index.ts"), "utf8")
  const adminIndex = readFileSync(join(SRC, "routes/admin/index.ts"), "utf8")
  const adminMounts = [...adminIndex.matchAll(/\.route\(\s*"([^"]*)"\s*,\s*(\w+)\s*\)/g)]

  const all: Route[] = []
  for (const m of index.matchAll(/app\.route\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g)) {
    const [, prefix, router] = m
    if (router === "adminRoutes") {
      for (const a of adminMounts) all.push(...routesOf(a[2]!, prefix! + a[1]!))
    } else {
      all.push(...routesOf(router!, prefix!))
    }
  }
  return all
}

const routes = collect()
const hits: [Route, Route][] = []
for (let i = 0; i < routes.length; i++) {
  for (let j = i + 1; j < routes.length; j++) {
    if (routes[i]!.method !== routes[j]!.method) continue
    if (shadows(routes[i]!.path, routes[j]!.path)) hits.push([routes[i]!, routes[j]!])
  }
}

console.log(`按注册顺序检查了 ${routes.length} 条路由`)
if (hits.length === 0) {
  console.log("✓ 没有路由被遮蔽")
  process.exit(0)
}
for (const [first, second] of hits) {
  console.log(`\n⚠ ${second.method} ${second.path}  （${second.file}）`)
  console.log(`   进不去：被先注册的 ${first.method} ${first.path} 吃掉（${first.file}）`)
  console.log(`   改法：把它挪到那条之前注册，或换一个不同形的路径`)
}
process.exit(1)
