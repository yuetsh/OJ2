import { readFileSync } from "node:fs"

import { readMigrationFiles } from "drizzle-orm/migrator"
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

  // readMigrationFiles 只返回 { sql, hash, folderMillis }，不给文件名。日志和报错里
  // 说「0002_drop_django_leftovers」比说「1787740469403」有用得多，所以自己读一遍 journal。
  const tags = readMigrationTags()

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
      .map((f) => ({
        tag: tags.get(f.folderMillis) ?? String(f.folderMillis),
        reasons: destructiveReasons(f.sql.join("\n")),
      }))
      .filter(({ reasons }) => reasons.length > 0)

    if (blocked.length > 0 && process.env.OJ2_ALLOW_DESTRUCTIVE !== "1") {
      console.error(
        "待执行的迁移里有破坏性语句，已停下：\n" +
          blocked.map(({ tag, reasons }) => `  · ${tag}：${reasons.join(" / ")}`).join("\n") +
          "\n\n这类改动不可逆，不该在一次日常部署里顺手执行。" +
          "\n确认已经做过备份之后，用这个显式放行：\n\n" +
          "  OJ2_ALLOW_DESTRUCTIVE=1 docker/deploy.sh\n",
      )
      process.exit(4)
    }

    console.log(`待执行 ${pending.length} 条迁移，开始。`)
    let done = 0
    for (const file of pending) {
      const tag = tags.get(file.folderMillis) ?? String(file.folderMillis)
      try {
        await applyMigration(client, file, tag)
      } catch (error) {
        // 裸抛的话看到的是 postgres.js 内部的堆栈，真正的原因（那一行 PostgresError）
        // 被埋在中间。这里只留有用的部分。
        const detail = error instanceof Error ? error.message : String(error)
        const naked = NO_TRANSACTION_MARKER.test(file.sql[0] ?? "")
        console.error(
          `\n迁移 ${tag} 失败：${detail}\n\n` +
            (naked
              ? "这条迁移标了 oj2:no-transaction，**没有事务保护** —— 失败点之前的语句已经生效。\n" +
                "如果失败的是 CREATE INDEX CONCURRENTLY，库里多半留下了一个 INVALID 索引，\n" +
                "先 `DROP INDEX <名字>` 再重来（`select indexrelid::regclass from pg_index where not indisvalid` 能找出来）。\n"
              : "这条迁移已整体回滚，库里没有留下它的任何改动。\n") +
            `本次已经成功执行的 ${done} 条不会被回滚 —— 每条迁移各自一个事务。`,
        )
        process.exit(5)
      }
      done++
      console.log(`  ✓ ${tag}`)
    }
    console.log("迁移完成。")
  } finally {
    await client.end()
  }
}

function destructiveReasons(sql: string) {
  const bare = stripComments(sql)
  return DESTRUCTIVE_PATTERNS.filter(([re]) => re.test(bare)).map(([, label]) => label)
}

/**
 * 从 `meta/_journal.json` 读出 `when → tag` 的对应。`readMigrationFiles` 不返回文件名，
 * 但日志和报错里说得出「0002_drop_django_leftovers」比说「1787740469403」有用得多。
 *
 * 读不到就返回空表 —— 到这一步 `readMigrationFiles` 已经成功读过同一个文件了，
 * 真读不到也只是日志退化成时间戳，不该因此中止一次迁移。
 */
function readMigrationTags(): Map<number, string> {
  try {
    const journal = JSON.parse(readFileSync(`${migrationsDir}/meta/_journal.json`, "utf8")) as {
      entries?: Array<{ when: number; tag: string }>
    }
    return new Map((journal.entries ?? []).map((e) => [e.when, e.tag]))
  } catch {
    return new Map()
  }
}

/**
 * 写在迁移文件**开头**的这行标记，表示这条迁移不能包在事务里跑。
 *
 * 唯一的用途是 `CREATE INDEX CONCURRENTLY` —— Postgres 明确禁止它出现在事务块里，
 * 而大表加索引又常常不能接受 `CREATE INDEX` 那段锁写窗口。
 *
 * 代价要清楚：**没有回滚**。中途失败时前面的语句已经生效，而且 CONCURRENTLY 失败还会
 * 在库里留下一个 INVALID 索引，得手工 `DROP INDEX` 之后重来。所以这种迁移**一个文件
 * 只放一条语句**，别图省事把几条塞一起。
 */
const NO_TRANSACTION_MARKER = /^[ \t]*--[ \t]*oj2:no-transaction\b/m

/**
 * 执行一条迁移。
 *
 * 这里没有用 drizzle 自带的 `migrate()`，原因有两条，都在 `pg-core/dialect.js` 里摆着：
 *
 * 1. 它把**所有**待执行的迁移塞进同一个 `session.transaction()`。于是第 3 条失败会把
 *    第 1、2 条一起回滚 —— 和 Django `migrate` 的逐条提交语义不一样，排查时也更难判断
 *    库到底停在哪儿。这里改成一条一个事务。
 * 2. 正因为全都在事务里，`CREATE INDEX CONCURRENTLY` 一律跑不了，没有任何开关。
 *
 * 记账行（`drizzle.__drizzle_migrations`）的写法和 drizzle 保持一致：`hash` 是整个文件的
 * sha256，`created_at` 是 journal 里的 `when`。migrator 只比 `created_at`、不校验 hash，
 * 所以两套执行器可以互换着用，不会互相看不懂对方写的记录。
 */
async function applyMigration(
  client: postgres.Sql,
  migration: ReturnType<typeof readMigrationFiles>[number],
  tag: string,
) {
  // 只留有可执行内容的段。`readMigrationFiles` 按 `--> statement-breakpoint` 切开后
  // 保留原文，所以纯注释段（比如 0002 开头那一大段说明）会自成一段。
  const statements = migration.sql.filter((stmt) => stripComments(stmt).trim() !== "")
  if (statements.length === 0) {
    // 上游已经拦过一次（那条兜底检查），走到这里说明拦漏了，宁可响一声也别静默跳过
    throw new Error(`${tag} 没有任何可执行语句`)
  }

  const record = (exec: postgres.Sql | postgres.TransactionSql) =>
    exec`insert into drizzle.__drizzle_migrations ("hash", "created_at")
         values (${migration.hash}, ${migration.folderMillis})`

  if (NO_TRANSACTION_MARKER.test(migration.sql[0] ?? "")) {
    // 走简单查询协议：扩展协议会把语句包进一个隐式事务块，CONCURRENTLY 照样被拒。
    for (const stmt of statements) await client.unsafe(stmt).simple()
    await record(client)
    return
  }

  await client.begin(async (tx) => {
    for (const stmt of statements) await tx.unsafe(stmt)
    await record(tx)
  })
}
