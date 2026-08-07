# 阶段 3 修复复评

日期：2026-08-07
复评范围：commit `9c04b00..f548aef`（4 个提交），对照 `docs/specs/phase3-fix-list.md` 的 6 条 findings + 2 条收尾修复（F4b、F5b）。
方法：读 diff + 读源码 + 独立实跑（不复用实施者的证据，除非明确说明）。所有测试数据均已清理并核对还原。

---

## 逐条核验

### F1 —— 匿名可读任意用户完整档案【Critical】→ **ADDRESSED**

`apps/api/src/routes/account.ts:101` 在 `optionalAuth` 之后立即 `if (!c.get("user")) return success(c, null)`，早于任何数据库查询。

独立实跑：
```
匿名 GET /api/profiles/e2etest -> 200 {"data":null}
```
`services/profile.ts` 的 `showRealName` 参数链路未动，登录看自己档案不受影响（未重复验证，逻辑未改，风险低）。
前端 `apps/web/src/shared/api.ts:28` 已有 `data === null` 分支，兼容确认（读码确认，未跑前端）。

### F2 —— 学生真名无条件下发【Critical】→ **ADDRESSED**（默认关闭开关，非逐处删字段）

见下方「重点判断 1」，结论：14 个下发点全部经过统一的 `sampleUser()`，默认 `realName: null`，唯一显式打开的是 `contest.ts:209`（比赛榜单，且区分 admin/非 admin）。

独立实跑（与 diff 里的证据不同的端点，避免只是复读实施者的话）：
```
匿名 GET /api/rankings/users?limit=2      -> [{"username":"student","realName":null},{"username":"e2etest","realName":null}]
匿名 GET /api/problems?limit=2 createdBy  -> {"id":1,"username":"devadmin","realName":null} (x2)
匿名 GET /api/problems/1002 createdBy     -> {"id":1,"username":"devadmin","realName":null}
```
`grep -rn "realName" apps/api/src --include=*.ts` 复查：除 `sampleUser` 内部实现、`db.select()` 取列、`account.ts:94`（注册写库常量 null）、`services/profile.ts:29`（F1 已核实的独立开关）外，没有任何路由手写 `{ ..., realName }` 对象绕过 `sampleUser()`。

### F3 —— 匿名绕过提交可见性守卫【Critical】→ **ADDRESSED**

`submission.ts:227`：`!(await getBooleanOption(...)) && !isAdminRole(user)`，`isAdminRole(null)` 返回 `false`，`!false = true`，匿名正确落入受限分支。

独立实跑（临时把 `submission_list_show_all` 写为 `false`，测后 DELETE 该行，确认恢复为 `[]`）：
```
匿名     GET /api/submissions -> total = 0
登录学生 GET /api/submissions -> total = 0
```
两者一致地受限，F3 描述的「匿名权限大于登录用户」的错位已消除。

### F4 —— 提交详情返回 info/ip【Important】→ **ADDRESSED**

`submission.ts:199`：`const full = isAdminRole(user)`，不再以 `row.submission.userId === user.id` 放行。`/submissions/:id` 挂 `requireAuth`，匿名根本到不了这里，不存在新的匿名向量。

### F4b —— contestId 未脱敏 → **ADDRESSED，已用真实比赛提交独立验证**（原报告只有代码审查，本次补上实跑）

`submission.ts:214`：`contestId: full ? row.submission.contestId : null`。

独立实跑（造了一场临时比赛 + 一条挂在该比赛下的真实提交，验证后已删除，见下方清理记录）：
```
DB 实际存储：{"contestId":7,"ip":"9.9.9.9"}
提交所有者 (Regular User) GET /api/submissions/<id> ->
  {"info":{},"ip":null,"contestId":null, ...}   ← 三个字段全部脱敏
```
`contestId` 确实是被脱敏成 `null`，而不是碰巧本来就是 `null`（数据库里明确存的是 `7`）。控制方文档里点名"没验充分"的这一条已经补齐。

### F5 —— 判题机 token 弱默认值【Important】→ **ADDRESSED**

`config.ts` 的 `judgeServerToken()`：env 存在则用 env；不存在则 `randomBytes(32)` + `console.warn`。`docker/compose.dev.yml` 的 `${OJ2_JUDGE_TOKEN:?...}` 缺失时 compose 直接报错退出（未重新实跑 compose，读码 + 报告证据一致，逻辑简单，风险低）。

### F5b —— 仓库根 .env 读不到 → **ADDRESSED，加载器安全**

见下方「重点判断 3」，独立做了三组隔离测试（shell env 优先级、cwd .env 优先级、缺文件不崩、畸形行不崩），并额外做了一次端到端真实提交（问题 1002，Python3），确认判题机用当前 `.env` 里的 token 正常认证、提交离开 PENDING/JUDGING（拿到 result=-2，非 PENDING/JUDGING，证明判题机-后端握手成功）。测试提交与计数器已回滚，见清理记录。

### F6 —— 提交接口缺限流【Important】→ **ADDRESSED，参数与旧后端逐字对齐（独立验证）**

见下方「重点判断 4」。独立绕过 HTTP 层直接调用 `consumeToken()` 12 次（避免污染 submission 计数）：
```
#1~#10  allowed:true
#11     allowed:false, wait≈33.32s
#12     allowed:false, wait≈33.32s
```
`wait = (1 - 0) / 0.03 ≈ 33.33`，与旧后端 `fill_rate=0.03` 精确吻合，`default_capacity=10` 也吻合（第 11 次才被挡）。

---

## 四个重点判断

### 1. F2 是否真的做成了「默认关闭的开关」？

**是。** `apps/api/src/routes/helpers.ts` 的 `sampleUser()` 是唯一入口，`options.includeRealName === true` 才下发真名，默认 `false`。核对了全仓 14 个下发点（比 findings 文档的 13 处多一个，多出的是 `problem.ts:333`，原先就写死 `null`，现在统一走 `sampleUser` 入口，不影响结论）：

| 下发点 | 状态 |
|---|---|
| rankings/users、announcements(x2)、messages、tutorials/:id、problems 列表(x2)、problem-sets(x2)、problemset progress、contest creator(x2)、contest problems(x2) | 全部 `sampleUser(user, realName)`，默认关 |
| `contest.ts:209`（比赛榜单） | 唯一 `{ includeRealName: admin }`，对齐旧后端 `contest/serializers.py:84` |

`grep -rn "realName:" apps/api/src/routes/*.ts` 复查无遗漏（本次独立复跑，非照抄报告）。**不是逐处删字段**——`sampleUser()` 是统一的序列化函数，下次新增端点如果照抄现有写法（调用 `sampleUser`）默认就是关的，不会重犯。唯一的隐患是「有人手写字面量绕过 `sampleUser`」，diff 里已经全部清干净，长期靠代码评审维持（无法用类型系统强制，值得记一条范围外观察）。

### 2. `isRegularUser` 是否真的只有一处调用？删除后是否有其它同类空值陷阱？

**只有一处，属实。** `grep -rn "isRegularUser" --include=*.ts .`（排除 node_modules，覆盖整个仓库而非只有 apps/、packages/）只命中 `helpers.ts` 里的警示注释，无任何遗留调用点。

**搜了其它同类模式**（对 `null` 用户取 `adminType` 做权限判断），命中 `apps/api/src/routes/flowchart.ts:98`：
```ts
if (c.req.query("myself") === "1" || (!username && user.adminType === "Regular User")) ...
```
这处**不是**同类陷阱：该路由挂在 `flowchartRoutes.get("/flowcharts", requireAuth, ...)`，`user` 由 `c.get("user")!` 取得，`requireAuth` 保证非空，匿名到不了这行。这是「Regular User 专属限制」的合法写法（限制普通用户只看自己的，不限制教师/管理员），语义与 F3 的场景不同——F3 的路由是 `optionalAuth`，匿名 `user` 可能为 `null`。**未在 diff 内，非本次改动引入，仅作范围外观察记录**，不计入 findings。

其余 `adminType` 使用点（`classroom.ts`、`account.ts`、`contest.ts` 的 `inArray`/`sql` 过滤，`services/contest.ts` 的 `isContestAdmin`）均为「构造 SQL 过滤条件」或「非 null 保证下的角色判断」，没有第二个「匿名反而权限更大」的实例。

### 3. F5b 的 `.env` 加载器是否安全？

**安全，三点分别独立验证：**

- **真实 env 优先于仓库根 `.env`**：`JUDGE_SERVER_TOKEN=from-shell-env bun -e '...'` 得到 `from-shell-env`，不是 `.env` 里的值。
- **cwd 下的 `.env`（Bun 自动加载）优先于仓库根 `.env`**：`bun --env-file=.env.test-cwd` 模拟 cwd 优先加载后，`loadRepoRootEnv()` 因为 `process.env[key] !== undefined` 而跳过，结果仍是 cwd 的值。
- **解析不会被畸形行搞崩**：构造了空值（`=novalue`）、无等号行、前导空格键、单/双引号、值里带等号、`export FOO=bar` 语法、行内 `#` 注释、CRLF 结尾等混合样本喂给等价解析逻辑，全部正常跳过或按字面处理，无异常抛出。（`export FOO=bar` 会被解析成键名 `"export FOO"`，即该变量实际上不会被正确加载——是一个小的解析局限，不是崩溃，本仓库的 `.env`/`.env.example` 都不用这种写法，记为范围外观察。）
- **根目录无 `.env` 时静默跳过**：`readFileSync` 抛 `ENOENT`，`catch {}` 吞掉，不影响启动——这是生产场景（真实环境变量注入）的必经路径，逻辑上有覆盖（未在容器里额外验证，风险低，纯 try/catch 结构）。
- **端到端**：仓库根 `.env` 当前有真实 `JUDGE_SERVER_TOKEN`，直接提交一条真实代码（问题 1002/Python3），判题机在数秒内返回非 PENDING/JUDGING 结果，证明 token 握手成功、判题闭环工作，不是只停留在配置读取层面。

### 4. 限流参数是否真的对齐旧后端？

**是，非拍脑袋。** 对照 `OnlineJudge/options/options.py:120`：
```python
throttling = {"ip": {"capacity": 100, "fill_rate": 0.1, "default_capacity": 50},
              "user": {"capacity": 20, "fill_rate": 0.03, "default_capacity": 10}}
```
与 `apps/api/src/services/throttling.ts` 的 `throttlingDefaults` 逐字段相同。

**挂点位置**对照 `OnlineJudge/submission/views/oj.py:68`（`SubmissionAPI.post`）：`throttling()` 在 `check_contest_permission`（比赛权限校验）之后、取 `Problem` 之前调用——`apps/api/src/routes/submission.ts` 的挂点（比赛权限校验后、`db.select(schema.problem)` 前）位置一致。

**独立数值验证**：绕开 HTTP 直接调用 `consumeToken()` 12 次，第 11 次起被拒，`wait≈33.32s`，与 `(1 token 缺口) / (fill_rate=0.03) ≈ 33.33s` 吻合，`default_capacity=10` 与观察到的"第 11 次才拒绝"一致。参数和算法都对得上，不是抄了个数字但算法跑偏。

（Lua 脚本把旧实现「非线程安全」的读改写做成了原子操作，这是双方都认可的合理增强，不是风险点。）

---

## 修复 diff 内新引入的破坏

**无。**

- `bunx tsc --noEmit` 独立重跑，0 错误。
- 独立冒烟测试 `/api/contests`、`/api/problems`、`/api/problem-sets`、`/api/rankings/users`、`/api/announcements`、`/api/submissions`、`/api/problems/1002` 等端点，均 200，`sampleUser()` 各调用点（含 `row ?? { id, username: "" }` 的 null 分支、`{ id: row.creatorId, username: row.creatorUsername }` 的裸对象分支）未见运行时异常。
- `apps/web` 零改动（diff stat 确认），F1/F4 对前端的潜在影响（`data:null` 分支、`info.data` 表格不渲染）均有既存代码兜底或本就是回归到旧后端行为，读码确认不炸。
- F4b 的 `contestId` 收口用真实比赛提交实测通过，未见回归。

## 范围外观察（仅记录，不阻塞）

1. `apps/api/src/routes/flowchart.ts:98` 有一处外观相似的 `user.adminType === "Regular User"` 判断，但路由挂 `requireAuth`，不构成 F3 类陷阱。建议后续如果这条路由改成 `optionalAuth`，需要一并检查。
2. `.env` 解析器不支持 `export KEY=value` 语法（会把 `export KEY` 当整个键名），本仓库当前 `.env`/`.env.example` 不用这种写法，暂无影响。
3. F2 的「默认关闭」防线目前只靠约定（大家都调用 `sampleUser()`），没有类型系统强制。长期看这是 admin 侧 45 个端点铺开前值得补一道 lint/测试的地方，但不属于本次 findings。
4. 限流的 429 是新引入的 HTTP 语义（旧后端全走 200+error 信封），前端目前没有针对 429 的专门处理（报告里已自述，非新发现）。

## 结论

**All findings addressed: Yes**

F1 / F2 / F3 / F4 / F4b / F5 / F5b / F6 —— 8 项全部 ADDRESSED，均有独立实跑或读码验证支持，diff 范围内未发现新引入的破坏。
