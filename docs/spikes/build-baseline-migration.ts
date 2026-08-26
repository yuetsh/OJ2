#!/usr/bin/env bun
// 把 docs/specs/schema.sql（生产库的 pg_dump --schema-only）转成可执行的基线迁移
// apps/api/src/db/0000_crazy_gateway.sql。
//
// 这是**一次性**的转换，产物已经入库。留着它是为了说清 0000 的出处、以及日后万一要
// 从一份新的生产 dump 重做基线时不用从头想一遍规则。日常改 schema 不要碰这里，
// 走 `bun run db:generate`。
//
// 跑法（仓库根）：
//   bun docs/spikes/build-baseline-migration.ts
//
// 产物是确定性的：同一份 schema.sql 跑出来的字节完全一样，改完可以直接 git diff 看。
import { readFileSync, writeFileSync } from "node:fs"

const SOURCE = "docs/specs/schema.sql"
const TARGET = "apps/api/src/db/0000_crazy_gateway.sql"

// drizzle 的语句分隔标记。故意不写成字面量常量之外的形式：`readMigrationFiles` 是纯文本
// 切分，这个串出现在哪里都会切，所以生成出来的文件的**注释里**绝不能带上它。
const BREAKPOINT = "--> statement-breakpoint"

// 判断一条语句是不是 Django 遗留物：只看它引用了哪些**对象**（`public.X` 形式），
// 不看语句里有没有出现这些字样。
//
// 踩过的坑：一开始扫整条语句里的 `auth_` / `django_` 字样，结果把 `user` 表整个滤掉了 ——
// 它有一列叫 `auth_token`。列名不带 `public.` 前缀，按对象引用来判就不会误伤。
//
// 覆盖到的形式：CREATE TABLE/SEQUENCE public.X、CREATE INDEX ... ON public.X、
// ALTER TABLE [ONLY] public.X、ALTER SEQUENCE public.X OWNED BY public.Y.id、
// 以及外键里的 REFERENCES public.Y —— 对象名全都跟在 `public.` 后面。
const OBJECT_REF = /public\."?([a-z_]+)"?/g
const DJANGO_PREFIX = ["auth_", "django_"]

function isDjango(stmt: string) {
  return [...stmt.matchAll(OBJECT_REF)].some(([, name]) => DJANGO_PREFIX.some((p) => name.startsWith(p)))
}

const HEADER = `-- OJ2 的基线迁移：把一个空库建成新后端要的结构。
--
-- 这份文件**不是** \`drizzle-kit generate\` 的产物，也不该由它重新生成。原本这里是
-- \`drizzle-kit pull\` 吐出来的东西，整份被 /* */ 包着、一条可执行语句都没有，于是
-- 「空库没法靠迁移自举」——新环境、演练、别人接手，都得先手工 psql 灌一遍 schema.sql。
--
-- 现在的内容由 \`docs/specs/schema.sql\`（生产库 2026-08-07 的 pg_dump --schema-only）
-- 机械转换而来：去掉 psql 专有指令（\\restrict / SET / set_config）、去掉 7 张 Django
-- 遗留表及其索引与外键，其余原样保留、顺序不动，语句之间插上 drizzle 的分隔标记。
-- 转换脚本：\`docs/spikes/build-baseline-migration.ts\`。
--
-- 注意：那个分隔标记是纯文本切分，\`readMigrationFiles\` 不管它出现在哪里 —— 写进注释里
-- 一样会把文件切开。所以本文件的注释里不要出现它的字面量（我踩过一次，报错是
-- 「syntax error at or near "。"」，因为注释被从中间切断了）。
--
-- 为什么不含 Django 那 7 张表：\`meta/0000_snapshot.json\` 从来就没有它们（pull 当时用
-- tablesFilter 滤掉了），所以不建它们才和快照一致。0002 那条 DROP 全带 IF EXISTS，
-- 在新库上是空转，在生产库上才真删——两边跑同一串迁移，落点相同。
--
-- **改 schema 不要动这个文件**，走 \`bun run db:generate\` 生成新的迁移。
-- 生产库早已把 0000 标记成已执行（migrator 只比 created_at、不校验 hash），
-- 所以这份内容的任何改动都不会在生产库上重放。
`

const statements: string[] = []
let buffer: string[] = []
let droppedDjango = 0
let droppedNoise = 0

for (const line of readFileSync(SOURCE, "utf8").split("\n")) {
  const trimmed = line.trim()

  // 语句之外的行：空行、注释、psql 元命令（\restrict）直接跳过；
  // SET / set_config 是 pg_dump 给自己用的会话设置，迁移里不需要。
  if (buffer.length === 0) {
    if (trimmed === "" || trimmed.startsWith("--") || trimmed.startsWith("\\")) continue
    if (trimmed.startsWith("SET ") || trimmed.startsWith("SELECT pg_catalog.set_config")) {
      droppedNoise++
      continue
    }
  }

  buffer.push(line)

  // 按行尾分号断句。schema.sql 里句中出现分号的只有注释行，而注释行进不到这儿。
  if (!trimmed.endsWith(";")) continue

  const stmt = buffer.join("\n").trim()
  buffer = []

  if (isDjango(stmt)) {
    droppedDjango++
    continue
  }
  if (/^ALTER TABLE .* OWNER TO /.test(stmt) || stmt.startsWith("COMMENT ON")) {
    droppedNoise++
    continue
  }
  statements.push(stmt)
}

if (buffer.length > 0) throw new Error(`有没闭合的语句：${buffer[0]}`)

const body = statements.map((s) => s.replace(/;+$/, "")).join(`;\n${BREAKPOINT}\n`)
writeFileSync(TARGET, `${HEADER}\n${body};\n`)

console.log(`保留 ${statements.length} 条语句 | 滤掉 Django 相关 ${droppedDjango} 条、噪音 ${droppedNoise} 条`)
console.log(`已写入 ${TARGET}`)
