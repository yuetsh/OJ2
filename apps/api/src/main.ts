/**
 * 唯一入口。所有角色都从这里按子命令分叉。
 *
 * 为什么不保留三个独立入口文件：`bun build --compile` 一次只产出一个二进制，
 * 而部署要跑 HTTP 服务、判题 worker，SQL 判题还要 fork 一个能被 SIGKILL 的子进程
 * （见 judge/sql/index.ts）。三个入口就得编三个二进制、镜像里塞三份运行时。
 * 一个二进制 + 子命令，镜像里只有一份，compose 里改 command 就能换角色。
 *
 *   oj2-api              # 等同 serve
 *   oj2-api serve        # HTTP + WebSocket
 *   oj2-api worker       # BullMQ 判题消费者
 *   oj2-api healthcheck  # 探活，给 Dockerfile 的 HEALTHCHECK 用
 *   oj2-api sql-child    # SQL 判题子进程，由服务自己 spawn，不该手动调
 *
 * 用动态 import 而非顶层 import：这几个模块都有导入即执行的副作用
 * （Bun.serve、连 Redis 开消费者），静态导入会让 sql-child 也把整个服务拉起来。
 */

export {} // 只有动态 import 的话 TS 不认这是模块，顶层 await 会报错

const command = process.argv[2] ?? "serve"

switch (command) {
  case "serve":
    await import("./index")
    break
  case "worker":
    await import("./worker")
    break
  case "sql-child": {
    const { runSqlChild } = await import("./judge/sql/child")
    await runSqlChild()
    break
  }
  // 运行镜像是 debian-slim，没有 curl/wget，探活让二进制自己做。
  // 只打 /health，不碰库 —— 库挂了该由库自己的 healthcheck 报，
  // 不该让 api 容器跟着被判成不健康、进而被重启。
  case "healthcheck": {
    const { config } = await import("./config")
    try {
      const response = await fetch(`http://127.0.0.1:${config.port}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      process.exit(response.ok ? 0 : 1)
    } catch {
      process.exit(1)
    }
  }
  default:
    console.error(`未知子命令：${command}\n可用：serve | worker | sql-child`)
    process.exit(2)
}
