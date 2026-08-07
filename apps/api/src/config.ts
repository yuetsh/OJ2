import { randomBytes } from "node:crypto"

/**
 * 判题机 token。对齐旧后端 `options/options.py:93`：
 *   token = os.environ.get("JUDGE_SERVER_TOKEN"); return token if token else rand_str()
 * env 缺失时生成随机值 fail-safe —— 宁可判题机连不上（启动时有明显告警），
 * 也不要在仓库里写死一个人人都知道的弱默认值。
 */
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
  avatarDirectory: process.env.AVATAR_DIRECTORY ?? "data/avatar",
  avatarUriPrefix: process.env.AVATAR_URI_PREFIX ?? "/public/avatar",
  aiBaseUrl: process.env.AI_BASE_URL ?? "https://api.deepseek.com",
  aiKey: process.env.AI_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "deepseek-v4-flash",
  ruffPath: process.env.RUFF_PATH ?? "ruff",
  clangFormatPath: process.env.CLANG_FORMAT_PATH ?? "clang-format",
}
