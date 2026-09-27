import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

import { z } from "zod"

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
      process.env[key] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "")
    }
  } catch {
    // 根目录没有 .env 是正常情况（例如生产用真实环境变量注入），静默跳过
  }
}

loadRepoRootEnv()

/**
 * 环境变量在**启动时**一次解析完，有错就列出全部问题退出，不带病起来。
 *
 * 原来是 `Number(env ?? 默认值)` 散写：`JUDGE_CONCURRENCY=two` 得到 NaN，BullMQ 拿着
 * NaN 当并发数照样起；`DATABASE_URL` 漏配就静默连上开发库的默认账号。这类错都不在
 * 启动时报，而是到第一个请求、第一条提交才以莫名其妙的形式冒出来。
 *
 * **编译形态（线上）下，库、Redis、判题机 token 必须显式给**：dev 的默认值指向本机
 * 5433 / 6380，放到容器里要么连不上、要么连错，都不如当场报错。
 * 空字符串一律按「没设」处理 —— compose 里 `${X:-}` 展开出来就是空串。
 */
const blankAsUnset = (value: unknown) => (value === "" ? undefined : value)
const text = (fallback: string) =>
  z.preprocess(blankAsUnset, z.string().default(fallback))
const positiveInt = (fallback: number) =>
  z.preprocess(
    blankAsUnset,
    z.coerce.number().int().positive().default(fallback),
  )
const requiredWhenCompiled = (devDefault: string) =>
  isCompiled
    ? z.preprocess(blankAsUnset, z.string({ error: "编译形态下必须设置" }))
    : text(devDefault)

const envSchema = z.object({
  PORT: positiveInt(3000),
  DATABASE_URL: requiredWhenCompiled(
    "postgres://onlinejudge:onlinejudge@localhost:5433/onlinejudge",
  ),
  REDIS_URL: requiredWhenCompiled("redis://localhost:6380"),
  SESSION_TTL_SECONDS: positiveInt(7 * 24 * 60 * 60),
  COOKIE_SECURE: z.preprocess(
    blankAsUnset,
    z.enum(["true", "false"]).optional(),
  ),
  JUDGE_SERVER_URL: text("http://localhost:8081"),
  // dev 不设时生成一次性随机值，见 judgeServerToken()
  JUDGE_SERVER_TOKEN: isCompiled
    ? z.preprocess(blankAsUnset, z.string({ error: "编译形态下必须设置" }))
    : z.preprocess(blankAsUnset, z.string().optional()),
  JUDGE_CONCURRENCY: positiveInt(2),
  AVATAR_DIRECTORY: text("data/avatar"),
  TEST_CASE_DIRECTORY: text("data/test_case"),
  UPLOAD_DIRECTORY: text("data/upload"),
  HITOKOTO_DIRECTORY: text("data/hitokoto"),
  ALLOWED_WS_ORIGINS: text(""),
  UPLOAD_URI_PREFIX: text("/public/upload"),
  AVATAR_URI_PREFIX: text("/public/avatar"),
  AI_BASE_URL: z.preprocess(
    blankAsUnset,
    z.url().default("https://api.deepseek.com"),
  ),
  AI_PROVIDER: text("deepseek"),
  AI_KEY: text(""),
  AI_MODEL: text("deepseek-flash"),
  AI_HINT_DIAGNOSE: z.preprocess(blankAsUnset, z.enum(["1", "0"]).optional()),
  RUFF_PATH: text("ruff"),
  CLANG_FORMAT_PATH: text("clang-format"),
})

function parseEnv() {
  const parsed = envSchema.safeParse(process.env)
  if (parsed.success) return parsed.data
  console.error(
    "[config] 环境变量有误，拒绝启动：\n" +
      parsed.error.issues
        .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
        .join("\n"),
  )
  process.exit(1)
}

const env = parseEnv()

/**
 * 相对路径按 `pathBase` 解析（开发时是仓库根，编译后是 cwd），基准的取舍见 runtime.ts。
 *
 * 生产环境**应当**用绝对路径的环境变量把这些目录显式指定掉，相对路径只是开发便利。
 */
function repoPath(value: string) {
  return isAbsolute(value) ? value : resolve(pathBase, value)
}

/**
 * 判题机 token。对齐旧后端 `options/options.py:93`：
 *   token = os.environ.get("JUDGE_SERVER_TOKEN"); return token if token else rand_str()
 * env 缺失时生成随机值 fail-safe —— 宁可判题机连不上（启动时有明显告警），
 * 也不要在仓库里写死一个人人都知道的弱默认值。编译形态下缺了直接拒绝启动（见上面）。
 */
function judgeServerToken() {
  if (env.JUDGE_SERVER_TOKEN) return env.JUDGE_SERVER_TOKEN
  console.warn(
    "[config] JUDGE_SERVER_TOKEN 未设置，已生成一次性随机 token。" +
      "判题机将无法通过鉴权，本地开发请在 .env 里设置 JUDGE_SERVER_TOKEN，" +
      "并让 docker/compose.dev.yml 的 OJ2_JUDGE_TOKEN 取同一个值。",
  )
  return randomBytes(32).toString("hex")
}

// AI 是可选功能（.env.example 写明留空即关），所以只告警不退出 —— 但要在启动时说，
// 别等到学生点了「AI 提示」才从一条 401 里看出来
if (!env.AI_KEY && process.argv[2] !== "sql-child") {
  console.warn("[config] AI_KEY 未设置，AI 分析 / 提示 / 流程图评分都不可用。")
}

export const config = {
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  sessionCookie: "oj2_session",
  sessionTtlSeconds: env.SESSION_TTL_SECONDS,
  secureCookies: env.COOKIE_SECURE === "true",
  judgeServerUrl: env.JUDGE_SERVER_URL,
  judgeServerToken: judgeServerToken(),
  judgeConcurrency: env.JUDGE_CONCURRENCY,
  avatarDirectory: repoPath(env.AVATAR_DIRECTORY),
  // 判题沙箱把这个目录挂成只读的 /test_case，两边必须指同一处
  testCaseDirectory: repoPath(env.TEST_CASE_DIRECTORY),
  uploadDirectory: repoPath(env.UPLOAD_DIRECTORY),
  // 一言数据集（hitokoto.cn 官方导出），和旧后端读同一份：容器里是 /data/hitokoto。
  // 本机 dev 默认路径下没有这份数据，读不到就回落到内置的几条，不影响启动。
  hitokotoDirectory: repoPath(env.HITOKOTO_DIRECTORY),
  /**
   * WebSocket 升级时额外放行的来源（逗号分隔的完整 origin，如 https://oj.example.com）。
   * 同源本来就放行，只有前后端分处不同域名时才需要配。
   */
  allowedWebSocketOrigins: env.ALLOWED_WS_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  uploadUriPrefix: env.UPLOAD_URI_PREFIX,
  avatarUriPrefix: env.AVATAR_URI_PREFIX,
  aiBaseUrl: env.AI_BASE_URL,
  /** 只用来写 ai_analysis.provider 这一列，换 provider 时和 AI_BASE_URL 一起改 */
  aiProvider: env.AI_PROVIDER,
  aiKey: env.AI_KEY,
  aiModel: env.AI_MODEL,
  /**
   * AI 提示走两段式（先诊断、再生成），见 services/hint-diagnosis.ts。**默认关**：
   * 2026-09-19 起 ai_hint 在攒单段式的基线数据，攒够之前别打开，否则两批数据混在一起没法比。
   * 设成 "1" 打开。
   */
  aiHintDiagnose: env.AI_HINT_DIAGNOSE === "1",
  ruffPath: env.RUFF_PATH,
  clangFormatPath: env.CLANG_FORMAT_PATH,
}
