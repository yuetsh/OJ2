/**
 * 加载 jieba。开发和编译两种形态走不同的路，因为没有一条路两边都能用。
 *
 * ## 编译形态（生产）
 *
 * `@node-rs/jieba` 的 `index.js` 在运行时探测平台再 `require` 对应的子包，
 * `dict.js` 用 `__dirname` 去读同目录的 `dict.txt`。这两件事在
 * `bun build --compile` 之后都不成立 —— 二进制里 `__dirname` 和模块解析根都是
 * `/$bunfs/root`，子包和 dict.txt 都不在那儿。实测编译后直接
 * `Failed to load native binding`，而且**只在离开仓库目录后才报**（在仓库里跑时
 * 它顺着 cwd 摸到了 node_modules，假装没事），是那种到服务器上才炸的坑。
 *
 * 所以编译形态下把 `.node` 和 `dict.txt` 用 `with { type: "file" }` 内嵌成资源，
 * 运行时 Bun 把它们摊在 `/$bunfs/root/` 下，`require()` 和 `readFileSync` 都能正常拿到。
 *
 * ## 开发形态
 *
 * 但 `.node` 的资源导入**只有打包器认，运行时不认**：`bun run` 遇到
 * `import x from "….node" with { type: "file" }` 会报
 * “To load Node-API modules, use require() or process.dlopen instead of import.”，
 * 整个服务起不来。所以开发时老老实实用包自己的入口，那条路在 `bun run` 下是好的。
 *
 * 两个分支都必须是**动态** import：静态 import 在模块加载时就会求值，
 * 用 `isCompiled` 判断也来不及，dev 一样会撞上上面那个报错。
 *
 * 平台写死 linux-x64-gnu：部署目标是 debian 基底的容器，本机开发也是 x64 glibc。
 * 换基底镜像或 CPU 架构必须**同时**改两处 —— 这里的 import，和 apps/api/package.json
 * 里 `@node-rs/jieba-linux-x64-gnu` 那条依赖。
 *
 * 那条依赖为什么要显式写：它本是 `@node-rs/jieba` 的 optionalDependency，本机装出来的
 * node_modules 是扁平的，靠提升就能解析到，所以本地构建一直是好的。但容器里 bun 用
 * isolated 布局（包都在 `node_modules/.bun/` 下），提升不到，`bun build` 直接报
 * `Could not resolve`。代码既然真的直接 import 它，就该是直接依赖。
 */

import { isCompiled } from "../runtime"

export interface JiebaInstance {
  cut(text: string, hmm?: boolean): string[]
  loadDict(dict: Buffer): void
}

/** 内置词典建一个分词器。idf.txt 用不到，不内嵌，省二进制体积 */
export async function withBuiltinDict(): Promise<JiebaInstance> {
  if (!isCompiled) {
    const { Jieba } = await import("@node-rs/jieba")
    const { dict } = await import("@node-rs/jieba/dict")
    return Jieba.withDict(dict) as unknown as JiebaInstance
  }

  const { readFileSync } = await import("node:fs")
  const addonPath = (
    await import("@node-rs/jieba-linux-x64-gnu/jieba.linux-x64-gnu.node", {
      with: { type: "file" },
    })
  ).default as unknown as string
  const dictPath = (await import("@node-rs/jieba/dict.txt", { with: { type: "file" } }))
    .default as unknown as string

  let addon: { Jieba: { withDict(dict: Buffer): JiebaInstance } }
  try {
    addon = require(addonPath)
  } catch (error) {
    throw new Error(
      `加载 jieba 原生模块失败（${addonPath}）。若已更换容器基底或 CPU 架构，` +
        `需同步修改 src/vendor/jieba.ts 里写死的 linux-x64-gnu 导入。原始错误：${String(error)}`,
    )
  }
  return addon.Jieba.withDict(readFileSync(dictPath))
}
