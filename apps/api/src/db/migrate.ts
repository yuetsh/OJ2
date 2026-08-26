import { readMigrationFiles } from "drizzle-orm/migrator"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

import { migrationsDir } from "../runtime"

/**
 * 会造成不可逆数据丢失的语句。DROP INDEX / DROP CONSTRAINT 不在内 —— 它们不掉数据，
 * 拦下来只会让日常部署平白多一道人工确认。
 *
 * `ALTER COLUMN ... TYPE` 算进来是因为它要重写整表、拿 ACCESS EXCLUSIVE 锁，
 * 而且窄化类型时会报错或截断。
 */
const DESTRUCTIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\bdrop\s+table\b/i, "DROP TABLE"],
  [/\bdrop\s+schema\b/i, "DROP SCHEMA"],
  [/\balter\s+table\s+.+\s+drop\s+column\b/is, "DROP COLUMN"],
  [/\balter\s+column\s+.+\s+type\b/is, "ALTER COLUMN ... TYPE"],
  [/\btruncate\b/i, "TRUNCATE"],
]

/** 去掉 `--` 行注释和 `/* *\/` 块注释，免得注释里提到 drop table 就误判 */
function stripComments(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "")
}

const BASELINE_HOWTO = `先建基线表并把 0000 标记成已执行（相当于 Django 的 --fake-initial）：

  CREATE SCHEMA IF NOT EXISTS drizzle;
  CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
  INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES ('baseline-0000-faked', 1786070652521);

详见 CLAUDE.md「改 schema 走 drizzle migration」。`

export async function runMigrations() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("没有 DATABASE_URL，不知道该迁移哪个库")
    process.exit(2)
  }

  // readMigrationFiles 找不到 meta/_journal.json 会直接抛，堆栈指向 drizzle 内部，
  // 看不出真实原因。而这恰恰是最可能发生的失误：镜像里漏拷迁移目录。
  let files: ReturnType<typeof readMigrationFiles>
  try {
    files = readMigrationFiles({ migrationsFolder: migrationsDir })
  } catch {
    console.error(
      `读不到迁移目录：${migrationsDir}\n` +
        "编译产物不内嵌迁移文件，它们随镜像装在固定路径下。\n" +
        "检查 docker/Dockerfile 里那条 `COPY apps/api/src/db/ ...`，" +
        "或用 OJ2_MIGRATIONS_DIR 显式指定。",
    )
    process.exit(2)
  }
  if (files.length === 0) {
    console.error(`${migrationsDir} 下没找到任何迁移。镜像里的迁移目录是不是漏拷了？`)
    process.exit(2)
  }

  // max: 1 —— advisory lock 是会话级的，多连接会让锁挂在另一条连接上，等于没锁
  const client = postgres(url, { max: 1, onnotice: () => {} })

  try {
    // 防止两次部署撞在一起同时迁移。key 是随手取的常量，只要全项目一致就行
    await client`select pg_advisory_lock(4478215096)`

    const applied = await client<{ last: string }[]>`
      select coalesce(max(created_at), -1)::text as last
      from drizzle.__drizzle_migrations
    `.catch(() => null)

    // 基线缺失。这个库没法靠迁移自举 —— 0000 是 `drizzle-kit pull` 的产物，
    // 整个文件被块注释包着，一条可执行语句都没有。结构只能来自 docs/specs/schema.sql
    // 或生产 dump，然后手工把 0000 标记成已执行。
    const lastApplied = applied === null ? -1 : Number(applied[0]?.last ?? -1)
    if (lastApplied < 0) {
      const rows = await client<{ count: number }[]>`
        select count(*)::int as count from information_schema.tables where table_schema = 'public'
      `
      const tableCount = rows[0]?.count ?? 0
      console.error(
        tableCount > 0
          ? `库里已经有 ${tableCount} 张表，但没有迁移基线记录。\n` +
              "直接迁移会从 0000 跑起，而 0000 是 introspect 产物、整份被注释掉，跑不了。\n\n" +
              BASELINE_HOWTO
          : "这是个空库，迁移没法自举建表（0000 是 introspect 产物，整份被注释掉）。\n" +
              "先把结构灌进去：\n\n" +
              "  psql -d <库> -f docs/specs/schema.sql\n\n" +
              BASELINE_HOWTO,
      )
      process.exit(3)
    }

    const pending = files.filter((f) => f.folderMillis > lastApplied)
    if (pending.length === 0) {
      console.log("没有待执行的迁移。")
      return
    }

    // 兜底：真要跑到一条「没有可执行语句」的迁移，说明基线状态不对
    // （多半是 0000 被算进了 pending）。这种情况下 drizzle 会把整份注释当 SQL 发过去，
    // 报一个和真实原因毫不相干的 "unterminated /* comment"。宁可自己先说清楚。
    if (pending.some((f) => stripComments(f.sql.join("\n")).trim() === "")) {
      console.error(
        "待执行的迁移里有一条不含任何可执行语句（多半是 introspect 出来的 0000）。\n" +
          "基线记录不对，检查 drizzle.__drizzle_migrations。\n\n" +
          BASELINE_HOWTO,
      )
      process.exit(3)
    }

    const blocked = pending
      .map((f) => destructiveReasons(f.sql.join("\n")))
      .filter((reasons) => reasons.length > 0)

    if (blocked.length > 0 && process.env.OJ2_ALLOW_DESTRUCTIVE !== "1") {
      console.error(
        "待执行的迁移里有破坏性语句，已停下：\n" +
          blocked.map((reasons) => `  · ${reasons.join(" / ")}`).join("\n") +
          "\n\n这类改动不可逆，不该在一次日常部署里顺手执行。" +
          "\n确认已经做过备份之后，用这个显式放行：\n\n" +
          "  OJ2_ALLOW_DESTRUCTIVE=1 docker/deploy.sh\n",
      )
      process.exit(4)
    }

    console.log(`待执行 ${pending.length} 条迁移，开始。`)
    await drizzleMigrate(drizzle(client), { migrationsFolder: migrationsDir })
    console.log("迁移完成。")
  } finally {
    await client.end()
  }
}

function destructiveReasons(sql: string) {
  const bare = stripComments(sql)
  return DESTRUCTIVE_PATTERNS.filter(([re]) => re.test(bare)).map(([, label]) => label)
}
