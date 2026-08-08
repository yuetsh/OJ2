# Phase 4 安全评审 — SQL 判题引擎沙箱逃逸与资源耗尽

评审对象：`apps/api/src/judge/sql/`（engine.ts / child.ts / index.ts）+ 判题接线 `judge/run.ts:judgeSqlSubmission` + 测试点处理 `services/test-case.ts`。
参照旧实现：`OnlineJudge/judge/sql_runner.py` / `sql_dispatcher.py`（Python sqlite3 + authorizer / progress_handler / setlimit）。

**评审方式**：全部实跑。快速迭代喂 `child.ts` JSON 作业；关键结论走完整提交链路（建 SQL 题 → 提交 → 判题结果）与父进程 `index.ts` 逻辑。测试环境已还原（题目/提交/测试点目录已删，`student` 已改回 Regular User / None，无残留进程）。

> **修复记录（2026-08-07，本文档之后）**
>
> - **I-1 已修**：`runStudent` 加逐语句守卫，学生 SQL 里的 PRAGMA 一律拒（两种题型都拒，
>   对齐旧实现 authorizer 的 `_DENIED_ALWAYS`）。关键字判定用 `sqlite3_normalized_sql`，
>   注释/大小写/空白由 SQLite 自己抹平。另加兜底：每条语句前重放 `query_only` 与
>   `max_page_count`，即便判定漏了也关不掉只读。**M-1 的 `max_page_count` 可调大部分一并修掉。**
> - **I-2 已修**：子进程用 stderr 报阶段（`prepare` / `student` / `display`），父进程边读边换
>   兜底时限 —— 一进学生 SQL 就收到「题目时限 + 2s」。1s 限的题跑飞语句实测 **26s → 3.06s**。
>   顺带修正归因：卡在受信脚本（出题人的初始化/标准答案）现在报 SYSTEM_ERROR，不再甩给学生 TLE。
> **补充（2026-08-08，Minor 收尾）**
>
> - **M-1 已全部修完。** 第二半（`max_page_count` 学生可调大）在 I-1 拦 PRAGMA 时就一并
>   修掉了。第一半改成引擎侧按字节记账（`ByteBudget`）：单值超题目内存限、或结果集
>   累计超限，都按 MLE 拒。旧实现的 `setlimit(SQLITE_LIMIT_LENGTH)` 复刻不了 ——
>   sql.js 的 wasm 没导出 `sqlite3_limit`。实测**同一句 SQL 在 4MB 的题上被拦、
>   在 64MB 的题上放行**，题目的 `memoryLimit` 现在对学生是真约束。
>   （测试尺寸特意选在 8MB 而不是 100MB：wasm 堆触顶时的兜底报的是同一句错误信息，
>   用大值测根本分不清是谁拦的 —— 第一版测试就是这么误判的。）
> - **M-3 已由阶段 5 的分阶段超时顺带解决**：预览从 25s 降到 **13005ms** 实测。
> - **M-2 不修**（见下）。

> **M-2 的处理：不修，理由写在这里**
>
> 要做「强制两个测试点的期望结果不同」，得在建题时把每个测试点都跑一遍标准答案再比对。
> 技术上可行，但它会把一类**合法出题**也挡掉（比如刻意用两组不同数据验证同一个边界、
> 结果恰好相同），而代价是老师建题时被一条看不懂的错误拦住。评审也确认这与旧实现行为
> 一致、非回归。
>
> 更合适的做法是「提示」而不是「拒绝」，但那要动契约和后台前端。留给以后，
> 现在记在这里，免得下次评审又把它当成新发现。
> - `engine.ts` 头部的防护对照表已按实测重写，两处削弱写在正文里。
>   另记：stock sql.js 的 wasm **没有导出** `sqlite3_progress_handler` / `sqlite3_interrupt` /
>   `sqlite3_set_authorizer` / `sqlite3_limit`（已核对导出表），要用得自己编 wasm。

## 结论速览

| # | 威胁 | 结果 | 级别 |
|---|---|---|---|
| 1 | 文件系统逃逸（ATTACH 等） | **打不穿**。WASM 无宿主 FS 绑定，结构性隔离，比旧实现更强 | — |
| 2 | 超时挂住判题进程 | 单条长语句引擎拦不到，只靠父进程 25s 后 SIGKILL；1s 限的题实测 26s 才 TLE，25x 放大 + 判题池仅 2 并发 → 可拒绝服务 | **Important** |
| 3 | 内存耗尽 | 单值/瞬时内存被固定 512MB `ulimit -d` 兜住（已验证生效），但与题目 `memoryLimit` 脱钩，且 `max_page_count` 学生可自行调大 | **Minor** |
| 4 | 查询题只读绕过 | **破防**。`PRAGMA query_only=0` 一句即可恢复写权限，实测查询题用 DML 拿到 Accepted | **Important** |
| 5 | 硬编码常量作弊 | 多测试点防线成立（前提：测试点数据确实不同，代码只强制"≥2 个"不强制"数据不同"） | **Minor** |
| 6 | 出题人侧预览/生成 | 与学生同隔离，无宿主 FS，比旧实现更强；教师可让预览请求挂 25s | **Minor** |

对照表逐条核对结果（实现者声明 vs 实测）：

| 旧防护 | 新做法 | 核对结果 |
|---|---|---|
| authorizer 禁 ATTACH | WASM 无宿主 FS，结构上够不到 | ✅ **成立且更强** |
| authorizer 白名单让查询题只读 | `PRAGMA query_only=1` | ❌ **不成立**：学生可 `PRAGMA query_only=0` 反手关掉 |
| progress_handler 墙钟超时 | 子进程外部 SIGKILL | ⚠️ **部分成立**：只在父进程路径生效且慢 25x；单条长语句引擎内拦不到 |
| `setlimit(LIMIT_LENGTH)` | 子进程 `ulimit -d` | ⚠️ **部分成立**：`-d` 确实作用到最终进程，但固定 512MB、与题目内存限脱钩 |

---

## Important

### I-1 查询题只读可被 `PRAGMA query_only=0` 一句绕过

- **位置**：`apps/api/src/judge/sql/engine.ts:199-200`（`if (mode === "query") db.run("PRAGMA query_only=1")`），学生 SQL 随后在 `engine.ts:202 → executeStatements` 无任何语句级过滤地执行。
- **根因**：新实现放弃了 authorizer，学生 SQL 的 PRAGMA 完全不设防。`query_only` 只是一个可写开关，学生自己就能把它关回去。旧实现把 `SQLITE_PRAGMA` 放进 `_DENIED_ALWAYS`，学生连一条 PRAGMA 都跑不了（`sql_runner.py` `_run_student` authorizer）。
- **攻击手法**：查询题提交 `PRAGMA query_only=0; <任意 DML/DDL>; <正确 SELECT>`。
- **实测（完整提交链路，query 题 id=43，标准答案 `SELECT a FROM t ORDER BY a`）**：

  攻击提交：
  ```sql
  PRAGMA query_only=0; UPDATE t SET a=a; SELECT a FROM t ORDER BY a;
  ```
  → `RESULT 0`（**ACCEPTED**）—— UPDATE 成功执行，只读约束失效。

  对照提交（不带 PRAGMA）：
  ```sql
  UPDATE t SET a=a; SELECT a FROM t ORDER BY a;
  ```
  → `RESULT 4`（RUNTIME_ERROR）`err_info: 本题为查询题，禁止修改数据或表结构…`

  child.ts 层复现同样区分：带 PRAGMA 的 `DELETE/INSERT` 走到 WA（写入生效），不带的报 readonly。
- **旧实现表现**：`PRAGMA query_only=0` 会被 authorizer 直接 DENY（`not authorized`），学生无法改动只读态；且白名单模式下任何非 SELECT 授权码都拒绝。
- **实际危害边界**：每个测试点都是独立的内存库、无宿主 FS、跨测试点不持久，因此**不构成沙箱逃逸，也不构成作弊**（学生仍需对所有测试点产出正确结果集，DML 帮不上）。危害限于：查询题的"只读"教学约束被破坏，学生可用增删改而非查询"混"过题目。但它直接证伪了对照表第 2 行的安全声明，且利用成本为零，故列 Important。
- **修复方向**：学生 SQL 执行前用 `iterateStatements` 预扫，遇到 PRAGMA（或至少 `query_only` / `max_page_count` / `writable_schema` 等敏感 PRAGMA）即拒；或在只读模式下用不可翻转的手段（如整库以 immutable/只读方式打开）替代可写开关。

### I-2 单条长语句超时只能靠父进程 25s 后 SIGKILL，放大 25x 且可拖垮判题池

- **位置**：`engine.ts:116-149`（`executeStatements` 的 deadline 检查在 **`engine.ts:126`**，只在语句之间触发）；`index.ts:45`（`setTimeout(kill, budgetMs + HARD_TIMEOUT_SLACK_MS)`）；`index.ts:80`（`runSqlCase` budget = `max(timeLimitMs*5, 10_000)`）；`index.ts:25`（`HARD_TIMEOUT_SLACK_MS = 15_000`）。
- **根因**：引擎的墙钟检查只发生在 `iterateStatements` 的每条语句开头。**一条长时间运行的语句（递归 CTE 死循环、大 CROSS JOIN 喂聚合）在单次 `step()` 内部执行，`step()` 期间不检查 deadline**，引擎无法中断。旧实现的 `progress_handler` 每 1000 条 VM 指令回调一次，在语句执行**过程中**就能按墙钟中断，约 `timeLimitMs`（1s）即杀。
- **攻击手法**：`WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM r) SELECT count(*) FROM r;`（聚合，不向外层吐行，`ROW_LIMIT` 也拦不到）。
- **实测**：
  - 直喂 child.ts（无父进程）：`timeout 12` 强杀，**子进程 12s 内从不自终**（引擎 deadline 对单语句无效）。
  - 走父进程 `index.ts` `runSqlCase`（timeLimitMs=1000）：`elapsed_ms=25005`，返回 `{"ok":false,"result":1,"message":"SQL 执行超时"}`。
  - **完整提交链路**（1s 限的 query 题）：从提交到出 `RESULT 1`（TLE）实测 **26 秒**。
- **判题池影响**：`config.ts:68` `judgeConcurrency` 默认 **2**；SQL 判题作业与所有语言共用同一 BullMQ 判题 worker。用户级限流 `capacity=20`（`throttling.ts:24`）。单个学生一次性提交 20 条死循环 SQL ≈ `20×25s / 2 = 250s`，**两个判题槽被占满约 4 分钟**，期间全体学生（含 Python/C）提交排队。考试/比赛期这是可用性风险。
- **旧实现表现**：`progress_handler` 在 ~1s（`timeLimitMs`）即中断，worker 几乎立刻释放。新实现慢 25 倍且完全依赖父进程（子进程独立运行时永不自终）。
- **修复方向**：把 `HARD_TIMEOUT_SLACK_MS` 从 15s 收紧、`runSqlCase` budget 别乘 5；或给 sql.js 编译进 `sqlite3_progress_handler` 等价的中断回调，在语句内按墙钟中断。

---

## Minor

### M-1 学生内存受固定 512MB `ulimit -d` 约束，与题目 `memoryLimit` 脱钩；`max_page_count` 学生可调大

- **位置**：`index.ts:23`（`CHILD_DATA_LIMIT_KB = 512 * 1024`，**硬编码**，不读题目 `memoryLimit`）；`index.ts:38-41`（`sh -c "ulimit -d …; exec …"`）；`engine.ts:101-108`（`newDatabase`：`max_page_count = memoryLimitMb*256`）。
- **核对"`ulimit -d` 是否真作用到最终 bun 进程"（重点关注项）**：**成立**。通过同款 `sh -c "ulimit -d 524288; exec bun …"` 包装起子进程后读 `/proc/self/limits`：
  ```
  Max data size    536870912    536870912    bytes
  ```
  `exec` 保留 rlimit，`-d` 确实落到最终 bun 进程。`hex(zeroblob(3e8))` 实测被拦，返回 `RESULT 3`（MEMORY_LIMIT_EXCEEDED，"单个数据值超出内存限制"），完整链路复现一致。所以 `-d` 而非 `-v` 的选型与"作用到最终进程"的声明都成立。
- **不足**：
  1. 512MB 是**全局固定值**，与题目 `memoryLimit`（如 64MB）无关。旧实现 `setlimit(SQLITE_LIMIT_LENGTH, memory_limit_mb*1MB)` 把单值上限贴着题目内存限（64MB）。新实现下 64MB 的题，学生单值/瞬时内存可到 ~512MB 才报 MLE（8x）。
  2. 题目内存限唯一的落点 `max_page_count` 是一条 **PRAGMA，学生可自行 `PRAGMA max_page_count=1000000` 调大**（同 I-1 根因：PRAGMA 不设防）。实测该 PRAGMA 被接受、无 authorizer 拒绝。因此题目 `memoryLimit` 对学生**不是权威约束**，真正的硬顶只有那 512MB。
- **危害边界**：512MB 仍能兜住机器（单进程封顶、`ROW_LIMIT=10000` 兜结果集行数），不至于拖垮宿主；只是"每题内存限"名不副实。故 Minor。

### M-2 测试点只强制"≥2 个"，不强制"数据不同"；作弊防线依赖出题人

- **位置**：`services/test-case.ts:102-105`（`if (options.sql && selected.length < 2) throw …`）。
- **核对作弊假设（题目要求至少 2 个数据不同的测试点，硬编码常量过不了）**：**假设成立，但仅在测试点数据确实不同的前提下**。
  - 实测（TC1 数据 `1,2,3`，TC2 数据 `10,20,30,40`）：提交硬编码 `SELECT 1 UNION SELECT 2 UNION SELECT 3;` → `RESULT -1`（WRONG_ANSWER）。多测试点防线有效。
  - 但代码只校验 `.sql` 文件个数 ≥2，**不校验两个测试点跑出的期望结果是否不同**。题目页展示的是**测试点 1** 的期望结果（`buildDisplay` 取 test case 1，`admin/problem.ts:160-173`），学生能看到 TC1 的答案。若出题人不慎让 TC2 的数据产出与 TC1 相同的结果集，硬编码即可 AC。
- **旧实现表现**：同样基于"跑标准答案 + 多测试点比对"，无"数据必须不同"的强校验，行为一致（非回归）。故 Minor，属出题人操作风险。

### M-3 出题人侧预览可挂 25s（教师自伤，有限）

- **位置**：`admin/problem.ts:653`（`/sql-test-cases/preview` → `buildSqlDisplay`），走同一子进程隔离，budget 10s + slack 15s。
- **实测**：教师 `refSql` 放死循环递归 CTE → 预览 HTTP 请求阻塞 **25005ms** 后返回 400 `生成展示数据超时或内存超限`。占用一个 HTTP 处理 25s。教师半可信、且限于自身请求，Minor。

---

## 试过但没打穿（覆盖面界定）

- **ATTACH 写宿主文件**（query & modify & 受信 init 三种上下文）：`ATTACH DATABASE '/tmp/…/evil.db' AS evil; CREATE TABLE evil.x…` → `unable to open database`，宿主上**无文件生成**。WASM（sql.js）默认 MEMFS，无 NODEFS 绑定，结构性够不到宿主 FS。
- **ATTACH 读已存在的宿主 sqlite 文件**（modify 模式，目标是真实 `secret.db`）：同样 `unable to open database`，读不到。
- **受信脚本（出题人 init）里的 ATTACH**：预览接口同样 `unable to open database`。旧实现靠 `_trusted_authorizer` 拒 ATTACH 且跑在有宿主 FS 的 Django 进程里；新实现结构性隔离，**更强**。
- **超大单值撑爆内存**：`hex(zeroblob(3e8))` → 被 512MB `ulimit -d` / WASM 堆拦，MEMORY_LIMIT_EXCEEDED，未 OOM 宿主。
- **结果集撑爆**：`ROW_LIMIT=10000` 在 `step()` 循环内计数，超限即 MLE（`engine.ts:136-138`）。
- **硬编码常量答案**（跨数据不同的 2 测试点）：WRONG_ANSWER。
- **多条语句的循环/超时**：语句之间的 `Date.now() > deadline`（`engine.ts:126`）能在 ~timeLimit 处以 `interrupted` → TLE 拦下（仅**单条**长语句拦不到，见 I-2）。
- **子进程 `finish()` 的 SIGKILL 自杀导致结果丢失/截断**：未复现。`child.ts:47-51` 用 `writeSync(1,…)` 循环写满全部字节再 `SIGKILL`；父进程 `index.ts:49-52` 并发 `new Response(child.stdout).text()` 持续排空管道。判题结果 payload 仅数百字节，全部实测被完整解析。理论残余风险：若 stdout payload 超过管道缓冲（64KB）且父进程未及时排空、fd 1 为非阻塞，`writeSync` 可能 EAGAIN 抛错丢输出——但当前 payload 体量下不触发，且父进程始终并发排空，判定低风险。设计中"跳过 Bun teardown 避免 `ulimit` 下 SIGILL panic 误判超时"的推理合理。
- **空 stdout → 超时误判**：父进程 `index.ts:58-66` 在子进程被 SIGKILL（stdout 空）时按 `@phase` 标记区分：卡在 display 报 SYSTEM_ERROR，卡在 judge 报 CPU_TIME_LIMIT_EXCEEDED。递归 CTE 死循环实测正确落到 TLE。

## 备注

- 未发现真正的沙箱逃逸（文件/进程/宿主）或能让错误答案判 Accepted 的作弊路径。最接近"严重"的是 I-2 的判题池拒绝服务（可用性），其次 I-1 的只读破防（安全控制失效但危害受限）。
- 环境已还原：题目 id=43 及其 5 条提交、`problem_tags` 关联、两个测试点目录（`d6sps…`、`v3h9…`）已删；`data/test_case/` 仅剩原有 `79343208b704f6e75b4b6d885285280e`；`student` 已改回 Regular User / None；无残留 `child.ts`/攻击进程。未改动任何 OJ2 / OnlineJudge / ojnext 源码（两旧仓 `git status` 干净）。
