# 阶段 3 修复报告

日期：2026-08-07
需求文档：`docs/specs/phase3-fix-list.md`（两份评审合并的 6 条 findings）
受修代码：`apps/api`（Hono + Drizzle），基线 commit `9c04b00`

提交：

| 短 SHA | 标题 | 覆盖 |
|---|---|---|
| `b4b61af` | fix(阶段3): 匿名不可读用户档案，真名改为默认不下发 | F1、F2 |
| `8237909` | fix(阶段3): 提交可见性守卫补上匿名，详情脱敏，提交接口加限流 | F3、F4、F6 |
| `b7adf29` | fix(阶段3): 去掉判题机 token 的弱默认值 | F5 |

验证环境：postgres `:5433`、redis `:6380`、judge `:8081`，API 跑在 `:3000`（`bun --watch`，改完自动重载）。
测试账号 `e2etest`/`Test123456`（Regular User）、`student`（Regular User，真名 `Phase 2 Student`）、
`devadmin`（Super Admin）。

`cd apps/api && bunx tsc --noEmit` → **0 错误**。
14 条路径 × {匿名, 登录} 冒烟 → **无 5xx**。

---

## F1 —— 匿名可读任意用户完整档案【Critical】

**改法**：`apps/api/src/routes/account.ts:101` 的 handler 开头加登录判断，未登录返回空。
对齐旧后端 `OnlineJudge/account/views/oj.py:40` 的 `UserProfileAPI.get` 首行
`if not user.is_authenticated: return self.success()`。

`services/profile.ts` **没动** —— 它已有 `showRealName` 形参，且调用方传的是
`c.get("user")?.id === target.id`（只有看自己的档案才给真名），这一点与旧后端
`UserProfileSerializer(profile, show_real_name=show_real_name)` 的语义一致。

**实跑对比**（为让证据可读，临时把 `e2etest` 的 `real_name` 设为 `张三-测试`，测后已还原为 `NULL`）：

修复前：
```
### F1 anon GET /api/profiles/e2etest
status 200 -> {"data":{"id":2,"user":{"id":4,"username":"e2etest","email":"e2e@local.test",
"adminType":"Regular User","problemPermission":"None","createTime":"2026-08-07 07:19:10.789+00",
"lastLogin":"2026-08-07 07:50:40.139+00","openApi":false,"isDisabled":false,"className":null},
"realName":null,"acmProblemsStatus":{"problems":{"5":{"_id":"1004","status":0}}},...
### F1 logged-in (self) GET /api/profiles/e2etest
status 200 email: e2e@local.test realName: 张三-测试
```

修复后：
```
### F1 anon GET /api/profiles/e2etest
status 200 -> {"data":null}
### F1 logged-in (self) GET /api/profiles/e2etest
status 200 email: e2e@local.test realName: 张三-测试
```

匿名拿到空，登录看自己的档案不受影响。

**前端影响：无。** `apps/web/src/shared/api.ts:28` 已经有
`if (response.data === null) return { error: null, data: null }` 的分支，天然兼容。

---

## F2 —— 学生真名无条件下发【Critical】

**改法（结构性，不是逐处删字段）**：`apps/api/src/routes/helpers.ts` 新增序列化层：

```ts
export function sampleUser(
  source: { id: number; username: string },
  realName: string | null | undefined,
  options: { includeRealName?: boolean } = {},
): SampleUser
```

`realName` 默认不下发，需要的地方显式传 `{ includeRealName: true }`。这是旧后端
`OnlineJudge/utils/api/_serializers.py` 的 `UsernameSerializer(need_real_name=False)`
同一套约定：全仓 11 处调用只有 `contest/serializers.py:84` 一处显式打开。

函数上写了注释，说明「所有下发用户对象的地方都必须走这个函数，不要再手写
`{ id, username, realName }`」——目的就是让后面 admin 侧 45 个端点铺开时不会重犯。

### 13 个下发点清单及处置

| # | 位置 | 端点 | 匿名可达 | 处置 |
|---|---|---|---|---|
| 1 | `routes/account.ts:168` | `GET /rankings/users` | 是 | `sampleUser()`，关 |
| 2 | `routes/problem.ts:86`（`listItem()`） | `GET /problems`、`GET /problems/:displayId/similar` | 是 | `sampleUser()`，关 |
| 3 | `routes/problem.ts:333` | `GET /problems/:displayId` | 是 | 原本就写死 `null`；改为走 `sampleUser()` 统一入口 |
| 4 | `routes/contest.ts:34`（`creator()`） | `GET /contests`、`GET /contests/:id` | 是 | `sampleUser()`，关 |
| 5 | `routes/contest.ts:131` | `GET /contests/:id/problems` | 否（比赛权限） | `sampleUser()`，关 |
| 6 | `routes/contest.ts:177` | `GET /contests/:id/problems/:displayId` | 否（比赛权限） | `sampleUser()`，关 |
| 7 | **`routes/contest.ts:209`** | `GET /contests/:id/rank` | 否 | **`{ includeRealName: admin }`，保留** —— 唯一打开的一处 |
| 8 | `routes/content.ts:43` | `GET /announcements` | 是 | `sampleUser()`，关 |
| 9 | `routes/content.ts:64` | `GET /announcements/:id` | 是 | `sampleUser()`，关 |
| 10 | `routes/content.ts:85` | `GET /messages` | 否（`requireAuth`） | `sampleUser()`，关 |
| 11 | `routes/content.ts:196` | `GET /tutorials/:id` | 是 | `sampleUser()`，关 |
| 12 | `routes/problemset.ts:62`（`problemSetCreator()`） | `GET /problemsets`、`GET /problemsets/:id` | 是 | `sampleUser()`，关 |
| 13 | `routes/problemset.ts:169` | `GET /problemsets/:id/problems` | 是 | `sampleUser()`，关 |
| 14 | `routes/problemset.ts:398` | 题单进度列表 | 否（教师及以上） | `sampleUser()`，关。旧后端 `problemset/serializers.py:248` 同样是默认关 |

清单比文档说的「13 个」多一条：文档大概把 `problem.ts:333`（本来就写死 `null`）没计入，
或者把 `problem.ts:86` 服务的两个端点算成一个。**14 处全部收口，无遗漏**：

```
$ grep -rn "realName:" apps/api/src/routes/*.ts | grep -v sampleUser \
    | grep -v "realName: schema.userProfile.realName" | grep -v "string | null"
account.ts:94:      realName: null,       ← 注册时写库的 insert values，不是下发点
helpers.ts:23:    realName: options.includeRealName === true ? (realName ?? null) : null,
```

`services/profile.ts:29` 的 `realName` 由 F1 的 `showRealName` 形参把关（只有看自己的档案才给），
与旧后端 `UserProfileSerializer` 一致，未改。

**实跑对比**（修复前用 `git stash` 把改动摘掉实测，非静态推断）：

修复前：
```
--- announcements (anon) ---
[{"id":2,"username":"student","realName":"Phase 2 Student"}]
--- contests createdBy (anon) ---
[{"id":4,"username":"e2etest","realName":"张三-测试"}]
--- contest rank as CONTEST ADMIN (e2etest, creator) ---
[{"id":2,"username":"student","realName":"Phase 2 Student"}]
--- contest rank as NON-admin (student) ---
[{"id":2,"username":"student","realName":null}]
--- contest detail createdBy (anon) ---
{"id":4,"username":"e2etest","realName":"张三-测试"}

### 匿名 GET /api/rankings/users
[{"id":4,"username":"e2etest","realName":"张三-测试"},{"id":2,"username":"student","realName":"Phase 2 Student"}]
```

修复后：
```
--- announcements (anon) ---
[{"id":2,"username":"student","realName":null}]
--- contests createdBy (anon) ---
[{"id":4,"username":"e2etest","realName":null}]
--- contest rank as CONTEST ADMIN (e2etest, creator) ---
[{"id":2,"username":"student","realName":"Phase 2 Student"}]      ← 仍然有，符合预期
--- contest rank as NON-admin (student) ---
[{"id":2,"username":"student","realName":null}]
--- contest detail createdBy (anon) ---
{"id":4,"username":"e2etest","realName":null}

### 匿名 GET /api/rankings/users
[{"id":2,"username":"student","realName":null},{"id":4,"username":"e2etest","realName":null}]
### 匿名 GET /api/problems (createdBy)
[{"id":1,"username":"devadmin","realName":null},{"id":1,"username":"devadmin","realName":null}]
```

比赛榜单对**比赛管理员**（这里是比赛创建者 `e2etest`）仍然下发真名，对非管理员仍然是 `null` —— 行为未变。

**前端影响**：`apps/web` 只在 `oj/api.ts:86`、`shared/api.ts:37,47` 读 `realName`，都做了
`?? ""` 的兜底，字段变 `null` 不会炸。真名本来也不该在这些位置显示。

---

## F3 —— 匿名绕过提交可见性守卫【Critical】

**改法**：`routes/submission.ts:220` 由 `isRegularUser(user)` 改为 `!isAdminRole(user)`
（非管理员即受限，匿名落入受限分支）。

**`isRegularUser` 的其他调用点：查过了，全仓只有这一处。**

```
$ grep -rn "isRegularUser" --include=*.ts apps/ packages/
apps/api/src/routes/submission.ts:31   （import）
apps/api/src/routes/submission.ts:211  （唯一调用点，即本 finding）
apps/api/src/routes/helpers.ts:27      （定义）
```

既然零个其他调用点，**把 `isRegularUser` 整个删掉**，原地留了一条注释说明为什么不要再加回来。
留着一个对 null 返回 false 的「是普通用户才受限」判定，就是给下一个人准备的坑。
（这一步超出了「只改 findings」的字面范围，但属于 F3 的根因，不是顺手重构。）

**实跑对比**（临时把 `options_sysoptions` 的 `submission_list_show_all` 置 false；
**该行原本不存在，测后已 DELETE**）：

修复前：
```
### F3 GET /api/submissions with submission_list_show_all=false
anon    total = 23        ← 全部可见
student total = 0         ← 被正确限制
```

修复后：
```
### F3 GET /api/submissions with submission_list_show_all=false
anon    total = 0
student total = 0
```

还原核验：
```
$ bun db.ts delete   →  deleted rows: 1
$ bun db.ts show     →  []          （该 key 无行，回到原始状态）
```

---

## F4 —— 提交详情返回判题内部信息与 IP【Important】

**改法**：`routes/submission.ts:195` 的 `const full = isAdminRole(user) || row.submission.userId === user.id`
改为 `const full = isAdminRole(user)`。

依据旧后端 `OnlineJudge/submission/views/oj.py:100-104`：

```python
if request.user.is_admin_role():
    submission_data = ... SubmissionModelSerializer ...      # fields = "__all__"
else:
    submission_data = ... SubmissionSafeModelSerializer ...  # exclude = ("info", "contest", "ip")
```

把关的是**角色**，不是「是不是自己的提交」。

**实跑对比**（用一条已判完、`info` 有内容的真实提交；`devadmin` 是 Super Admin）：

修复前（提交所有者 `e2etest`，Regular User）：
```
### F4 own submission detail
id 0249d3606fab3e05f4926c45d00efdee | has info: {"err":null,"data":[{"error":0,"memory":7811072,
"output":null,"result":-1,"signal":0,"cpu_time":3,"exit_code":0,"real_time":8,
"test_case":"1","output_md5":"c4ca4238a0b923820dcc509a6f75849b"},{"error": ... | ip: null
```

修复后：
```
submission 0249d3606fab3e05f4926c45d00efdee
OWNER (Regular User) -> info: {} | ip: null | result: -1
ADMIN (Super Admin)  -> info: {"err":null,"data":[{"error":0,"memory":7811072,"output":null,
"result":-1,"signal":0,"cpu_time":3,"exit_code":0,"real_time":8,"test_case":"1",
"output_md5":"c4ca4238a0b923820dcc509a6f75849b"},{"error":0,"memory":7749632, ... | ip: null
```

上面这条老提交的 `ip` 本来就是 `NULL`（本机请求没有 `X-Forwarded-For`），
为了单独验证 `ip` 确实被挡住，另造了一条带 `X-Forwarded-For: 10.11.12.13` 的提交：

```
库里实际值： [{"id":"...","ip":"10.11.12.13","info_type":"object"}]
OWNER (Regular User) -> info: {} | ip: null
ADMIN (Super Admin)  -> info: {} | ip: "10.11.12.13"
```

库里有值、学生看不到、管理员看得到 —— `ip` 是被脱敏而不是本来就空。

### 前端影响（这条确实波及前端）

`apps/web/src/oj/submission/detail.vue:149`：

```html
<n-data-table
  v-if="!hideList && submission.info && submission.info.data"
  :columns="columns"
  :data="submission.info.data"
/>
```

改完之后学生拿到 `info: {}`，`submission.info.data` 为 `undefined`，`v-if` 不成立，
**测试点结果表格不再渲染。不会报错，只是不显示。**

按要求仍按旧后端行为修。补充一点判断依据：**这不算功能回退**。旧后端 `SubmissionSafeModelSerializer`
本来就 `exclude=("info", ...)`，也就是说**生产环境的学生从来就没看到过这张表**——
`v-if` 的存在本身就是为这个场景写的。所以新后端这一版是「多给了」，现在改回去，
前端不需要适配，线上行为反而回到一致。

**另注意**：旧后端的 `SubmissionSafeModelSerializer` 还 exclude 了 `contest`，
新后端仍无条件下发 `contestId`。这超出 F4 的字面范围（评审只点了 `info` 与 `ip`），
本次**未改**，记在下方「疑虑」里。

---

## F5 —— 判题机 token 默认值硬编码【Important】

**改法**（三处）：

1. `apps/api/src/config.ts`：抽出 `judgeServerToken()`，env 缺失时 `randomBytes(32).toString("hex")`
   并 `console.warn` 告警。对齐旧后端 `OnlineJudge/options/options.py:93`：
   ```python
   token = os.environ.get("JUDGE_SERVER_TOKEN")
   return token if token else rand_str()
   ```
   选「随机 fail-safe」而不是「启动失败」，就是为了不把本地开发搞死 —— 服务照起，
   只是判题机心跳被 403 挡掉，日志里有明显告警。
2. `docker/compose.dev.yml`：`${OJ2_JUDGE_TOKEN:-oj2-dev-token}` → `${OJ2_JUDGE_TOKEN:?...}`，
   未设置时 compose 直接报错退出。文件顶部加了本地怎么设的三行命令。
3. `.env.example`：`JUDGE_SERVER_TOKEN=` 留空 + 生成命令注释，说明
   `JUDGE_SERVER_TOKEN`（后端读）与 `OJ2_JUDGE_TOKEN`（判题机容器读）名字不同但值必须一致。

**实跑对比**：

后端 —— 修复前 `config.judgeServerToken` 恒为 `"oj2-dev-token"`；修复后：
```
--- no env (fail-safe random) ---
[config] JUDGE_SERVER_TOKEN 未设置，已生成一次性随机 token。判题机将无法通过鉴权，
本地开发请在 .env 里设置 JUDGE_SERVER_TOKEN，并让 docker/compose.dev.yml 的 OJ2_JUDGE_TOKEN 取同一个值。
token: 9acd77a3ea1bbd17... len=64
--- second run: different value (proves it is random, not a repo constant) ---
token: f2328363bcda0ad9...
--- with env set ---
token: real-token-from-env
```
两次运行值不同 → 确实是随机，不是换了个仓库常量。env 存在时原样使用。

compose：
```
--- compose without OJ2_JUDGE_TOKEN ---
error while interpolating services.judge.environment.TOKEN:
required variable OJ2_JUDGE_TOKEN is missing a value: 请先设置 OJ2_JUDGE_TOKEN，见本文件顶部注释
--- compose with OJ2_JUDGE_TOKEN ---
      TOKEN: abc123
```

（当前跑着的判题机容器是用旧的 `oj2-dev-token` 起的，本次没有重启它 ——
下次 `docker compose up` 之前需要按注释设一次 `OJ2_JUDGE_TOKEN` 与 `JUDGE_SERVER_TOKEN`。）

---

## F6 —— 提交接口缺少限流【Important】

**参数来自旧后端，不是拍脑袋定的**：

- `OnlineJudge/utils/throttling.py` —— TokenBucket 算法
- `OnlineJudge/options/options.py:120` —— 默认参数
  ```python
  throttling = {"ip":   {"capacity": 100, "fill_rate": 0.1,  "default_capacity": 50},
                "user": {"capacity": 20,  "fill_rate": 0.03, "default_capacity": 10}}
  ```
- `OnlineJudge/submission/views/oj.py:36-42` —— `SubmissionAPI.throttling` **只用 user 桶**，
  key 是 `str(request.user.id)`；`auth_method == "api_key"` 时直接跳过

**改法**：新增 `apps/api/src/services/throttling.ts`：

- 同样只挂 user 桶、同样按 user id 做 key，默认参数逐字照抄，且和旧后端一样
  **实际值以数据库 `throttling` 配置项为准**，缺失时才用默认值
- 落在 redis（`throttling:user:<id>`），TTL = `capacity/fill_rate + 60` 秒，每次调用刷新
- **改用 Lua 脚本做成原子操作**。旧实现自己在 docstring 里写明「对于单个 key 的操作不是线程安全的」，
  而限流要挡的正是并发突发 —— 读改写有竞态等于没挡。算法与参数不变，只是把它做对
- 挂点位置与旧后端一致：比赛权限校验之后、取题目之前
- 超限返回 `429 too-many-submissions` + `Please wait N seconds`（旧后端文案
  `"Please wait %d seconds" % int(wait)`）。为此 `http.ts` 的 `failure()` 状态码联合类型加了 `429`

**实跑对比**（同一账号连打 15 次 `POST /api/submissions`）：

修复前：
```
### F6 rapid POST /api/submissions x15
  #1 201   #2 201   #3 201   #4 201   #5 201
  #6 201   #7 201   #8 201   #9 201   #10 201
  #11 201  #12 201  #13 201  #14 201  #15 201
```
15/15 全过，判题队列可以被一个脚本随便打满。

修复后：
```
### F6 rapid POST /api/submissions x15
  #1 201 ... #9 201
  #10 429:{"error":{"code":"too-many-submissions","message":"Please wait 23 seconds"}}
  #11 429 ... #15 429
```
9 条通过后开始 429。桶初始 `default_capacity=10`，此前 F4 的验证提交已消耗 2 个、
期间回填约 1 个，落在 9 —— 与参数吻合。

---

## 改动文件清单

| 文件 | finding |
|---|---|
| `apps/api/src/routes/account.ts` | F1、F2 |
| `apps/api/src/routes/helpers.ts` | F2（新增 `sampleUser`）、F3（删除 `isRegularUser`） |
| `apps/api/src/routes/contest.ts` | F2 |
| `apps/api/src/routes/content.ts` | F2 |
| `apps/api/src/routes/problem.ts` | F2 |
| `apps/api/src/routes/problemset.ts` | F2 |
| `apps/api/src/routes/submission.ts` | F3、F4、F6 |
| `apps/api/src/services/throttling.ts` | F6（新文件） |
| `apps/api/src/http.ts` | F6（`failure()` 支持 429） |
| `apps/api/src/config.ts` | F5 |
| `docker/compose.dev.yml` | F5 |
| `.env.example` | F5 |

`apps/web` **一个字节没改**（F1/F4 的前端影响见上文，均无需适配）。

---

## 纪律自查

- **旧仓库冻结**：`OnlineJudge/` 与 `ojnext/` 的 `git status --short` 均为空，全程只读。
- **没写测试**：符合项目既定策略，验证一律走实跑 API。
- **没有范围蔓延**：唯一超出 findings 字面范围的是「删掉 `isRegularUser`」和
  「`http.ts` 的 `failure()` 加 429」，前者是 F3 的根因、后者是 F6 的必要条件，都在上面说明了。
- **数据库改动全部还原**：

  | 改动 | 还原 | 核验 |
  |---|---|---|
  | `e2etest.real_name` 设为 `张三-测试` | 改回 `NULL`（原值已知） | `[{"username":"student","real_name":"Phase 2 Student"},{"username":"e2etest","real_name":null}]` |
  | `options_sysoptions` 插入 `submission_list_show_all=false`（**该行原本不存在**） | `DELETE` | `bun db.ts show` → `[]` |
  | 造了 1 个比赛 + 1 条榜单行 + 1 条公告（原本 0/0/0） | 全部删除 | `contests: 0 \| ranks: 0 \| announcements: 0` |
  | 限流/F4 测试产生 26 条提交 | 按快照删除，并把 `problem` 与 `user_profile` 的 `submission_number`/`accepted_number`/`statistic_info`/`acm_problems_status` 恢复到快照值 | `submissions now: 8 \| snapshot had: 8` |
  | `devadmin` 密码临时改成探针口令（为了验证 F4 的管理员视角） | 用保存的原 hash 写回 | `restored devadmin password hash, identical: true \| raw_password: devonly` |

  redis 里的 `throttling:*` 也清了（`deleted throttling keys: 1`），免得本地开发一上来就撞限流。
- **临时脚本全在 `/tmp` 的 scratchpad**，仓库里没留（`git status` 干净，只有 3 个提交）。
- **没有 drop/truncate 任何表。**

---

## 疑虑

1. **`contestId` 仍无条件下发**。旧后端的 `SubmissionSafeModelSerializer` 是
   `exclude = ("info", "contest", "ip")` —— 三个字段，新后端只脱敏了两个。
   评审 F4 只点了 `info` 与 `ip`，我按 finding 的字面范围修，没顺手动 `contestId`。
   泄露面比另外两个小得多（只是一个比赛 id，且比赛可见性另有把关），但**严格说没对齐旧后端**。
   建议下一轮一并处理，或明确判定新后端就是要下发它。

2. **限流的 429 状态码是新引入的语义**。旧后端所有错误都走 `self.error()` → HTTP 200 +
   `{"error": ..., "data": null}` 信封；新后端用真实状态码。前端目前**没有**针对 429 的处理，
   学生撞到限流时会走通用错误提示（能看到 `Please wait N seconds` 文案，但没有专门的 UI）。
   不阻塞，但前端接线时值得单独确认一下。

3. **限流按 user id 计，匿名不涉及** —— 因为 `POST /submissions` 挂了 `requireAuth`。
   旧后端的 ip 桶（`capacity 100, fill_rate 0.1`）在 `SubmissionAPI` 里同样没用上，
   所以这里是对齐的，不是漏搬。但配置项里保留了 ip 桶的默认值，将来要挂匿名端点可以直接用。

4. **判题机容器还在用旧 token**。F5 改的是「以后」的行为，当前跑着的
   `oj2-judge` 容器是之前用 `oj2-dev-token` 起的，本次没有重启它（重启会打断验证）。
   下次 `docker compose -f docker/compose.dev.yml up` 之前必须先按注释设好
   `OJ2_JUDGE_TOKEN` 与 `JUDGE_SERVER_TOKEN`（两者取同一个值），否则 compose 会直接报错。

5. **F2 的下发点我数出 14 处，文档说 13 处**。差异见上文表格的说明（大概率是
   `problem.ts:333` 本来就写死 `null` 没计入）。已用 grep 反证收口完整，
   但如果评审方手里有一份逐条清单，值得对一遍确认不是我漏看了某个反方向的差异。
