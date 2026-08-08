import { resolve } from "node:path"

/**
 * 运行形态的判定：开发时是 `bun src/main.ts`，生产是 `bun build --compile` 出来的单二进制。
 *
 * 两者最要命的差别是**路径**。编译产物里 `import.meta.dir` 恒为 `/$bunfs/root`
 * （Bun 把内嵌文件摊在那个虚拟目录下），于是任何 `resolve(import.meta.dir, "../..")`
 * 都会指到文件系统根：`data/test_case` 变成 `/data/test_case`。这种错误不会报错，
 * 只会安静地读写错地方，所以必须显式分叉，不能靠"相对路径反正差不多"。
 */
export const isCompiled = import.meta.dir.startsWith("/$bunfs")

/**
 * 起一个「自己」的子进程时该用的命令。SQL 判题要 fork 一个可被 SIGKILL 的子进程，
 * 见 judge/sql/index.ts。
 *
 * - 编译后：二进制自己就是入口，`[binary, "sql-child"]`
 * - 开发时：`process.execPath` 是 bun，得把入口脚本一起带上，`[bun, main.ts, "sql-child"]`
 */
export function selfCommand(subcommand: string): string[] {
  if (isCompiled) return [process.execPath, subcommand]
  return [process.execPath, resolve(import.meta.dir, "main.ts"), subcommand]
}

/**
 * 相对路径的解析基准。
 *
 * - 编译后：按进程 cwd 解析。容器里 workdir 固定，且这些目录本来就该由环境变量显式给出，
 *   cwd 只是最后的兜底。
 * - 开发时：按仓库根解析。因为 `bun run --filter '@oj2/api' dev` 会把 cwd 切到 apps/api/，
 *   而 docker/compose.dev.yml 挂给判题沙箱的是**仓库根**的 data/test_case —— 按 cwd 解析
 *   就会落到 apps/api/data/ 下，两边不是同一个目录，新传的测试点判题时报「找不到测试数据」。
 */
export const pathBase = isCompiled ? process.cwd() : resolve(import.meta.dir, "../../..")
