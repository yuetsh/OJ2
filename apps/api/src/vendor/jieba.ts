/**
 * 直接加载 @node-rs/jieba 的原生模块和词典，绕开这个包自己的加载逻辑。
 *
 * 为什么不老老实实 `import { Jieba } from "@node-rs/jieba"`：
 *
 * - 它的 `index.js` 在**运行时**探测平台再 `require` 对应的子包；
 * - 它的 `dict.js` 用 `__dirname` 去读同目录的 `dict.txt`。
 *
 * 这两件事在 `bun build --compile` 之后都不成立 —— 编译产物里 `__dirname` 和模块
 * 解析根都是 `/$bunfs/root`，子包和 dict.txt 都不在那儿。实测编译后直接报
 * `Failed to load native binding`，而且**只在离开仓库目录后才报**（在仓库里跑时
 * 它顺着 cwd 找到了 node_modules，假装没事），是那种在服务器上才炸的坑。
 *
 * 改成把 `.node` 和 `dict.txt` 用 `with { type: "file" }` 内嵌成资源：编译时它们被
 * 塞进二进制，运行时 Bun 把它们摊到 `/$bunfs/root/` 下，`require()` 和 `readFileSync`
 * 都能正常拿到。开发模式（不编译）下这个写法拿到的就是 node_modules 里的真实路径，
 * 两种模式同一份代码。
 *
 * 平台写死 linux-x64-gnu：部署目标是 debian 基底的容器，本机开发也是 x64 glibc。
 * 换平台（比如改用 alpine/musl 基底镜像）必须同步改这里的 import，否则编译能过、
 * 启动就崩 —— 所以下面加了显式的错误提示。
 */

import addonPath from "@node-rs/jieba-linux-x64-gnu/jieba.linux-x64-gnu.node" with { type: "file" }
import dictPath from "@node-rs/jieba/dict.txt" with { type: "file" }
import { readFileSync } from "node:fs"

export interface JiebaInstance {
  cut(text: string, hmm?: boolean): string[]
  loadDict(dict: Buffer): void
}

interface JiebaAddon {
  Jieba: { withDict(dict: Buffer): JiebaInstance }
}

let addon: JiebaAddon | null = null

function loadAddon(): JiebaAddon {
  if (addon) return addon
  try {
    addon = require(addonPath as unknown as string) as JiebaAddon
  } catch (error) {
    throw new Error(
      `加载 jieba 原生模块失败（${addonPath}）。若已更换容器基底或 CPU 架构，` +
        `需同步修改 src/vendor/jieba.ts 里写死的 linux-x64-gnu 导入。原始错误：${String(error)}`,
    )
  }
  return addon
}

/** 内置词典（dict.txt，约 4.8MB）。idf.txt 用不到，不内嵌，省二进制体积 */
export function withBuiltinDict(): JiebaInstance {
  return loadAddon().Jieba.withDict(readFileSync(dictPath as unknown as string))
}
