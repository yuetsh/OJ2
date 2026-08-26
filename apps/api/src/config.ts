import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

import { isCompiled, pathBase } from "./runtime"

/**
 * Bun 只自动加载「当前工作目录」下的 .env。而本应用的启动方式（`bun run --filter '@oj2/api' dev`）
 * 会把 cwd 切到 apps/api/，于是仓库根的 .env 读不到 —— 而 .env.example 恰恰教人写在根目录。
 * 这里显式补读仓库根的 .env，让文档指引真正生效，且不管从哪个目录启动都一致。
 *
 * 只填充尚未设置的键：真实环境变量与 cwd 下的 .env 优先级更高，不被覆盖。
 *
 * 编译成单二进制后不做这件事：生产靠 compose 注入环境变量，而 `import.meta.dir` 在
 * 二进制里是 `/$bunfs/root`，往上三级会去读 `/.env` —— 读到什么都是意外。
 */
function loadRepoRootEnv() {
  if (isCompiled) return
  try {
    const text = readFileSync(resolve(pathBase, ".env"), "utf8")
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      if (process.env[key] !== undefined) continue
      process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    }
  } catch {
    // 根目录没有 .env 是正常情况（例如生产用真实环境变量注入），静默跳过
  }
}

loadRepoRootEnv()

/**
 * 判题机 token。对齐旧后端 `options/options.py:93`：
 *   token = os.environ.get("JUDGE_SERVER_TOKEN"); return token if token else rand_str()
 * env 缺失时生成随机值 fail-safe —— 宁可判题机连不上（启动时有明显告警），
 * 也不要在仓库里写死一个人人都知道的弱默认值。
 */
/**
 * 相对路径按 `pathBase` 解析（开发时是仓库根，编译后是 cwd），基准的取舍见 runtime.ts。
 *
 * 生产环境**应当**用绝对路径的环境变量把这些目录显式指定掉，相对路径只是开发便利。
 */
function repoPath(value: string) {
  return isAbsolute(value) ? value : resolve(pathBase, value)
}

function judgeServerToken() {
  const fromEnv = process.env.JUDGE_SERVER_TOKEN
  if (fromEnv) return fromEnv
  console.warn(
    "[config] JUDGE_SERVER_TOKEN 未设置，已生成一次性随机 token。" +
      "判题机将无法通过鉴权，本地开发请在 .env 里设置 JUDGE_SERVER_TOKEN，" +
      "并让 docker/compose.dev.yml 的 OJ2_JUDGE_TOKEN 取同一个值。",
  )
  return randomBytes(32).toString("hex")
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
  sessionCookie: "oj2_session",
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 7 * 24 * 60 * 60),
  secureCookies: process.env.COOKIE_SECURE === "true",
  judgeServerUrl: process.env.JUDGE_SERVER_URL ?? "http://localhost:8081",
  judgeServerToken: judgeServerToken(),
  judgeConcurrency: Number(process.env.JUDGE_CONCURRENCY ?? 2),
  avatarDirectory: repoPath(process.env.AVATAR_DIRECTORY ?? "data/avatar"),
  // 判题沙箱把这个目录挂成只读的 /test_case，两边必须指同一处
  testCaseDirectory: repoPath(process.env.TEST_CASE_DIRECTORY ?? "data/test_case"),
  uploadDirectory: repoPath(process.env.UPLOAD_DIRECTORY ?? "data/upload"),
  // 一言数据集（hitokoto.cn 官方导出），和旧后端读同一份：容器里是 /data/hitokoto。
  // 本机 dev 默认路径下没有这份数据，读不到就回落到内置的几条，不影响启动。
  hitokotoDirectory: repoPath(process.env.HITOKOTO_DIRECTORY ?? "data/hitokoto"),
  uploadUriPrefix: process.env.UPLOAD_URI_PREFIX ?? "/public/upload",
  avatarUriPrefix: process.env.AVATAR_URI_PREFIX ?? "/public/avatar",
  aiBaseUrl: process.env.AI_BASE_URL ?? "https://api.deepseek.com",
  aiKey: process.env.AI_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "deepseek-v4-flash",
  ruffPath: process.env.RUFF_PATH ?? "ruff",
  clangFormatPath: process.env.CLANG_FORMAT_PATH ?? "clang-format",
}
