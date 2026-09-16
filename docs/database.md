# 数据库与迁移

`CLAUDE.md` 里只留了日常要记住的那几条，这里是细节：迁移执行器为什么是自己的、
空库怎么自举、给已有库打基线、以及 drizzle-kit 的几个坑。

## 迁移执行器是自己的，不是 drizzle 那个

`db/migrate.ts` 不调用 drizzle 的 `migrate()`，自己按 `meta/_journal.json` 逐条执行。
换掉它是因为 `pg-core/dialect.js` 里那个实现有两条硬伤：

1. **所有待执行的迁移共用一个事务**，第 3 条失败会把第 1、2 条一起回滚。现在是**一条一个
   事务**，语义和 Django `migrate` 一致，失败时也说得清库停在哪儿。
2. 正因为全在事务里，`CREATE INDEX CONCURRENTLY` 一律跑不了，没有开关。

记账行的写法和 drizzle 完全一致（`hash` = 整个文件的 sha256，`created_at` = journal 的
`when`），而 migrator 只比 `created_at`、不校验 hash，所以两套执行器可以互换，
不会看不懂对方写的记录。

**`bun run db:migrate` 走的就是这个执行器**（`bun src/main.ts migrate`），和线上
`oj2-api migrate` 完全同一条代码路径。`drizzle-kit migrate` 只在 `db:generate`
的对面存在，别再去调它 —— 对着已打基线的库裸跑会从 `0000` 撞上已存在的表、整个事务
回滚，**而且 exit 1 却一个错误都不打印**。

退出码：2 = 配置/文件问题，3 = 基线不对，4 = 撞上破坏性迁移，5 = 某条迁移执行失败。

### `CREATE INDEX CONCURRENTLY`

在迁移文件**第一行**写上标记，这条迁移就走裸执行（简单查询协议，不包事务）：

```sql
-- oj2:no-transaction
CREATE INDEX CONCURRENTLY "xxx_idx" ON "submission" USING btree ("language");
```

代价是**没有回滚**：中途失败时前面的语句已经生效，而且 CONCURRENTLY 失败会在库里留下
一个 INVALID 索引，要先 `DROP INDEX` 再重来
（`select indexrelid::regclass from pg_index where not indisvalid` 能找出来）。
所以**这种迁移一个文件只放一条语句**。

要不要用是另一回事：参考量级是 12.3 万行的部分索引，普通 `CREATE INDEX` 只锁 74ms，
一般不用纠结，CONCURRENTLY 留给真扛不住锁写窗口的场合。

### 破坏性迁移的三条放行路

含 `DROP TABLE` / `DROP COLUMN` / `DROP SCHEMA` / `ALTER COLUMN ... TYPE` / `TRUNCATE`
的迁移会让部署停在迁移这步并退出 4。`DROP INDEX` / `DROP CONSTRAINT` 不算 —— 它们不
掉数据，拦了只会让人习惯性带上放行开关。

1. 服务器上手工部署：`OJ2_ALLOW_DESTRUCTIVE=1 docker/deploy.sh`。
2. CI（`.github/workflows/deploy.yml`）：**必须先手工触发**并在 `workflow_dispatch` 上勾
   `allow_destructive`。push 触发拿不到这个 input，值恒为空 —— 也就是说**自动部署永远
   不会执行破坏性迁移**，只会停在闸门上把工作流判红。这是有意的：那种改动得有人先确认备份。
3. 先单跑迁移把结构推到位，再 push 代码：迁移一旦记进 `drizzle.__drizzle_migrations`
   就不会再跑，后续自动部署里它已不是 pending，自然不触发闸门。多环境共库时
   （机房 + 服务器）推荐这条。

**空库自举时这道闸不生效**：没有数据可丢，`0002` 那串 `DROP ... IF EXISTS` 全是空转，
拦下来只会逼每个新环境都带一次放行开关，把它训练成习惯动作。

## 空库能自举

`oj2-api migrate`（或本机 `bun run db:migrate`）指向一个空库时直接从 `0000` 建起：

```
空库，从 0000 开始自举。
待执行 16 条迁移，开始。
  ✓ 0000_crazy_gateway
  ✓ 0001_add_submission_public_create_time_idx
  …
  ✓ 0015_submission_filter_indexes
```

`0000_crazy_gateway.sql` 原本是 `drizzle-kit pull` 的产物、整份被 `/* */` 包着、可执行
语句 0 条，所以以前新库只能先手工灌一份 schema dump。现在它的内容由生产 dump 机械转换
而来（去掉 psql 专有指令、去掉 7 张 Django 遗留表及其索引外键，其余原样保留）。

**实测**（2026-09-16 复测，16 条迁移）：空库自举出来的结构，和「灌 schema dump + 打基线
+ 跑迁移」这条老路子跑出来的结构，`pg_dump --schema-only --no-owner --no-privileges`
逐行一致，1981 行零差异。本机开发库（`bun run db:up`）走的就是自举这条路。

改 0000 对生产库没有影响 —— migrator 只比 `created_at`、**从不校验 hash**，
而生产库那行 `baseline-0000-faked` 早把它挡在门外了。

⚠️ **0000 的注释里不要出现 statement-breakpoint 那个分隔标记的字面量。**
`readMigrationFiles` 是纯文本切分，不管它在不在注释里，照切不误 —— 注释被从中间切开，
后半截当成 SQL 发出去，报的是 `syntax error at or near "。"` 这种和真实原因毫不相干的错。

## 给一个已经存在的库做基线

drizzle 没有 `--fake-initial`。`migrate` 见到空的 `__drizzle_migrations`、库里却已经有表，
会拒绝执行并 exit 3。对已有数据的库第一次跑之前，先手插一行把 `0000` 标记成已执行：

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
  VALUES ('baseline-0000-faked', 1786070652521);   -- = meta/_journal.json 里 0000 的 when
```

migrator 只比 `created_at`，不校验 hash，所以 hash 随便填。

## drizzle-kit 的坑

`meta/0000_snapshot.json` 是 `pull` 出来的，没法无损还原 Django 建的 schema。
下面两处已经修过了，**别让它们回潮**：

- **bigint 上限精度**：`pull` 生成的 `maxValue: 9223372036854775807` 是 JS number 字面量，
  round-trip 成 `...776000`，每次 generate 都会多出 10 条 `ALTER COLUMN ... SET MAXVALUE`。
  已改成字符串。
- **表达式索引的 opclass**：`problem_tag_name_ci_unique` 在快照里带 `opclass`，但 drizzle
  自己序列化不出来，导致每次都 drop + recreate。已从快照里去掉。

（第三处「快照里的 Django 序列」已随 `0002_drop_django_leftovers` 删表一并解决，
`tablesFilter` 也移除了。）

**还有一个写代码时要绕开的 —— `.op()` 会吞掉索引方向。** 根因不是 `.desc()`，是 opclass：
drizzle-kit 的 `CreatePgIndexConvertor` 里那个三元一旦走进 opclass 分支就回不到方向分支
（`${it.opclass ? ` ${it.opclass}` : it.asc ? "" : " DESC"}`），而 `drizzle-kit pull`
给**每一列**都挂了 `.op(...)`，所以本仓库里「写了 `.desc()` 却生成不出 DESC」每次都会重演。

**要方向就别写 `.op()`。** 不写没有任何代价 —— `int4_ops` / `timestamptz_ops` 本来就是
这些类型的默认 opclass。实测（drizzle-kit 0.31.10，探针索引跑过 generate）：

| schema.ts | 生成的 SQL |
|---|---|
| `.desc().nullsFirst().op("timestamptz_ops")` | `"create_time" timestamptz_ops` ← 方向丢了 |
| `.desc().nullsFirst()` | `"create_time" DESC NULLS FIRST` ✅ |
| `.desc()` | `"create_time" DESC NULLS LAST` ✅ |

所以**多列混合方向的索引可以正常 generate**，不必手写。

假 diff 的机制也要理解对：带 `.op()` 时快照记的是 `asc: false`，SQL 建出来却是 ASC，
**分歧在快照和真实库之间**，不在快照和 schema.ts 之间 —— 所以再跑 generate 是干净的，
要等到下次 pull 才炸出来。这是当初难定位的原因。
