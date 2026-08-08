/**
 * `import path from "./x.wasm" with { type: "file" }` 的类型声明。
 *
 * 这个写法让 `bun build --compile` 把文件内嵌进单二进制，运行时拿到的是
 * `/$bunfs/root/...` 下的可读路径；不编译时拿到的是磁盘上的真实路径。
 * 二进制必须自足，不能在运行时去 node_modules 里找 —— 详见 vendor/jieba.ts 的注释。
 *
 * Bun 的类型里没覆盖这些扩展名，这里补上。值都是**文件路径字符串**。
 */

declare module "*.wasm" {
  const path: string
  export default path
}

declare module "*.node" {
  const path: string
  export default path
}

declare module "*.txt" {
  const path: string
  export default path
}
