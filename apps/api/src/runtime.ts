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

/**
 * 迁移文件（`0000_*.sql` … + `meta/_journal.json`）所在目录。
 *
 * 这些文件**不内嵌进二进制**，而是随镜像一起装到一个固定绝对路径下。
 * 之所以能这么做、也应该这么做：CLAUDE.md 里「单二进制是有代价的」那条讲的是
 * 不能依赖 node_modules、不能拿 `import.meta.dir` 去推路径（编译后它恒为
 * `/$bunfs/root`，往上几级就跑到文件系统根）。按一个**显式给定的绝对路径**读一个
 * 数据目录不在此列。
 *
 * 换来的好处是 drizzle 的 `migrate()` 能原样用 —— 它靠 `_journal.json` 自动发现
 * 迁移，和 Django 扫 `migrations/` 是一回事。要是改成内嵌，就得为每条迁移手写一行
 * import，那是迟早会漏的账。
 */
export const migrationsDir =
  process.env.OJ2_MIGRATIONS_DIR ??
  (isCompiled ? "/usr/local/share/oj2/migrations" : resolve(import.meta.dir, "db"))
