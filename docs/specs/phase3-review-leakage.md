# 阶段 3 评审：响应数据泄露

日期：2026-08-07
受审对象：`apps/api/src`（Hono + Drizzle，oj 侧 65 条端点）
参照基准：`OnlineJudge/<app>/serializers.py` 的 DRF serializer 白名单（只读，未改动）
方法：静态扫描 + 实跑取真实响应逐字段比对

---

## 1. 结论摘要

**Critical：0 条。Important：3 条。Minor：3 条。**

最重要的一条是 **`GET /api/profiles/:username` 允许匿名访问并返回 `user.email`**
（`routes/account.ts:101` + `services/profile.ts:19`）。旧后端 `UserProfileAPI.get`
第一件事就是 `if not user.is_authenticated: return self.success()`，匿名拿不到任何东西；
新后端挂的是 `optionalAuth`，不带任何 cookie 就能按用户名遍历全校学生邮箱。

好消息（**已逐条实证，不是推断**）：

- **`user.raw_password`（明文密码列）从未出现在任何 oj 侧响应里。** 全量响应体里
  grep `Test123456` / `student123` / `devonly` / `Probe123456` —— **0 命中**。
- `password` / `auth_token` / `open_api_appkey` / `session_keys` 这四个字段名
  **在全部响应里一次都没出现过**（对 111 次请求的响应做了递归字段名收集后统一 grep）。
- `problem.answers`（库里存的是**完整参考解代码**，C + Python）、`test_case_id`、
  `test_case_score`、`ast_rules` **全部没有出现在题目相关响应里**。
- `problem.template` 只返回 `//TEMPLATE BEGIN/END` 区间，`//PREPEND` / `//APPEND`
  隐藏区被正确剥掉（与旧 `parse_problem_template` 行为一致）。
- `contest.password` **没有泄露**。`GET /api/contests` 那句 `db.select()`（选全部列）
  后面接的是显式字段映射，password 只被用来算 `contestType`。
- 他人代码：`GET /api/submissions/:id` 的权限判定与旧 `check_user_permission` 等价，
  未 share 且题目未开 `share_submission` 时返回 404。

也就是说：**旧后端 serializer 挡住的"泄题类"字段，新后端一条都没漏。**
本次发现的问题集中在 **PII（邮箱、真实姓名）** 和 **判题细节（`info` / `ip`）** 两类。

---

## 2. 扫描方法与覆盖面

### 2.1 静态扫描

在 `apps/api/src` 下检索四种"选全部列"写法：

| 写法 | 命中数 | 结论 |
|---|---|---|
| `db.select()` 后不跟对象字面量 | 11 处 | 见第 4 节，**全部无泄露** |
| `db.query.xxx.findMany/findFirst` 无 `columns:` | 0 处 | 新后端完全没用 relational query API |
| `...row` / `...user` 整行展开进响应 | 1 处 | `problem.ts:228`，展开的是聚合查询结果（`total`/`accepted`），非表行 |
| `c.json(row)` 直接丢数据库行 | 0 处 | 全部响应走 `success(c, ...)` + Zod `.parse()` |

额外检查 `packages/contract`：**没有任何 `.passthrough()` / `z.looseObject` / `.catchall()`**，
Zod v4 object 默认 strip 未知键，因此"多选了列"本身不会自动变成泄露 ——
只有被显式写进 `.parse({...})` 入参的字段才会出去。这是新后端的第二道防线，实测有效。

`z.record(z.string(), z.unknown())` 有 16 处（`statisticInfo`、`exercise.data`、
`flowchartData`、`sqlConfig`、`acmProblemsStatus`、`submissionInfo`），
这些是 jsonb 原样透传，是唯一绕过 Zod 裁剪的通道。逐个核对过，见第 4/5 节。

### 2.2 动态扫描

API 跑在 `http://localhost:3000`。用三个身份 + 匿名共四种视角：

| 身份 | 说明 |
|---|---|
| `e2etest`（user 4） | 普通学生，主视角 |
| `leakprobe2`（user 5） | 现场用 `POST /api/users` 注册的第二个学生，验"看他人数据" |
| `student`（user 2） | 已有学生，作为"被看的人"（有提交、有 `real_name`） |
| 匿名（不带 cookie） | 验未登录可见面 |

因为库里 `contest` / `problemset` / `tutorial` / `exercise` / `announcement` /
`message` / `achievement` / `flowchart_submission` / `acm_contest_rank` 都是**空表**，
先造了带标记值的测试数据再打：

- 带密码的比赛（`password = 'SUPERSECRET-CONTEST-PW'`）+ 一道比赛题
- 题单 + 题单题（`hint = 'HINT-SECRET'`）+ 徽章 + 进度
- 教程 + 练习（`data.answer` / `data.explanation = 'SECRET-ANSWER-EXPLANATION'`）
- 隐藏成就（`name` / `description` 带标记）
- 他人的两条提交：一条 `shared = true`、一条 `shared = false`，`code` 带标记
- 题目 `template` 塞进 `//PREPEND BEGIN\nSECRET-PREPEND\n//PREPEND END` 等隐藏区
- 题目 `ast_rules` / `answers` 塞标记值

脚本对每个响应**递归收集全部字段路径**（含数组元素、最深 9 层），
再对字段名做敏感词匹配，同时对响应原文做标记值 grep（这一条能抓到"字段名没问题但值是别人的"的情况）。

**覆盖：111 次请求，65 条 oj 路由中 61 条拿到了 2xx 响应。**
未取得 2xx 的 4 条及原因：

| 路由 | 状态 | 原因 |
|---|---|---|
| `POST /api/judge-server/heartbeat` | 403 | 需要 judge server token，非 oj 学生面 |
| `POST /api/messages` | 403 | 仅 super admin 可调（与旧后端一致） |
| `POST /api/flowcharts` | 400 | 需要真实流程图 payload；`GET` 系列已覆盖同一序列化路径 |
| `POST /api/code/format` | 500 | 本机没装 `ruff` / `clang-format`；响应体无数据字段 |

原始响应留档：
`/tmp/claude-1000/-home-xuyue-Projects-OJ/ab9e12e4-.../scratchpad/{probe2,probe3,probe4}.txt`

### 2.3 环境还原

评审过程中造的数据**已全部清理**，改过的既有行已还原（见第 6 节的一条例外，需要你确认）。
临时脚本已从仓库删除，`git status` 干净。**未修改 OJ2 任何业务代码，未动 OnlineJudge / ojnext。**

---

## 3. Findings

### Important

---

#### I-1. `GET /api/profiles/:username` 匿名可访问，且返回 `user.email`

**位置**：`apps/api/src/routes/account.ts:101`、`apps/api/src/services/profile.ts:19`

```ts
// account.ts:101
accountRoutes.get("/profiles/:username", optionalAuth, async (c) => {
```
```ts
// services/profile.ts:19
email: row.user.email,
```

**旧后端**（`account/views/oj.py:36`，`UserProfileAPI.get`）：

```python
async def get(self, request, **kwargs):
    user = request.user
    if not user.is_authenticated:
        return self.success()          # ← 匿名直接返回空
```

**实际响应**（**完全不带 cookie**）：

```
$ GET /api/profiles/student            (no cookie)
[200]
{"data":{"id":1,"user":{"id":2,"username":"student",
  "email":"student@example.test",            ← 学生邮箱，匿名可见
  "adminType":"Regular User","problemPermission":"None",
  "createTime":"2026-08-07 04:27:24.688+00",
  "lastLogin":"2026-08-07 07:29:46.337+00",  ← 上次登录时间，匿名可见
  "openApi":false,"isDisabled":false,"className":null},
 "realName":null,"acmProblemsStatus":{...},"avatar":"/public/avatar/default.png",
 "mood":null,...,"acceptedNumber":1,"submissionNumber":5}}
```

**影响**：用户名在本站是公开的（`GET /api/rankings/users`、`GET /api/classes/:className/usernames`
都匿名可拿全量用户名），所以这等于**任何人都能离线遍历出全校学生的邮箱 + 上次登录时间**。
中职学生的邮箱多为学号/姓名拼音派生，属实名可关联数据。

**注意区分**：登录用户看他人 email 是**旧后端也有的行为**（旧 `UserSerializer.Meta.fields`
里就有 `email`，`UserProfileSerializer` 用的就是它）。**回归点只在"匿名也能看"**。
修的时候只需把 `optionalAuth` 换成 `requireAuth` 即可对齐旧行为；
如果想顺手收紧"登录用户看他人 email"，那是超出对齐范围的改进，需另行决定。

---

#### I-2. `realName`（学生真实姓名）在 8 处 `createdBy` / `user` 内嵌里未做门控

**位置**（每处都是把 `schema.userProfile.realName` 原样塞进响应）：

| 文件:行 | 端点 | 谁的真名 |
|---|---|---|
| `routes/account.ts:168` | `GET /api/rankings/users` | **学生本人**（匿名可见） |
| `routes/content.ts:85` | `GET /api/messages` | 消息发送者 |
| `routes/problemset.ts:398` | `GET /api/problem-sets/:id/user-progress` | **学生本人**（教师端） |
| `routes/problem.ts:86` | `GET /api/problems`、`GET /api/problems/:displayId` | 出题人 |
| `routes/content.ts:43` | `GET /api/announcements` | 公告作者 |
| `routes/content.ts:64` | `GET /api/announcements/:id` | 公告作者 |
| `routes/content.ts:196` | `GET /api/tutorials/:id` | 教程作者 |
| `routes/problemset.ts:169` | `GET /api/problem-sets/:id/problems` | 出题人 |
| `routes/contest.ts:131`、`contest.ts:177` | `GET /api/contests/:id/problems(/:displayId)` | 出题人 |

**旧后端**（`utils/api/_serializers.py:4`）：

```python
class UsernameSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    real_name = serializers.SerializerMethodField()

    def __init__(self, *args, **kwargs):
        self.need_real_name = kwargs.pop("need_real_name", False)   # ← 默认 False
        super().__init__(*args, **kwargs)

    def get_real_name(self, obj):
        return obj.userprofile.real_name if self.need_real_name else None
```

旧后端**只有比赛管理员**这一个调用点传 `need_real_name=True`
（`contest/serializers.py` 的 `ACMContestRankSerializer.get_user`）。
排行榜走的 `RankInfoSerializer` 用的是裸 `UsernameSerializer()` → `real_name` 恒为 `null`。

**实际响应**（**完全不带 cookie**；测试前给 user 4 设了 `real_name = 'REALNAME-SECRET-E2E'`）：

```
$ GET /api/rankings/users?limit=20      (no cookie)
[200]
{"data":{"results":[
  {"id":2,"user":{"id":4,"username":"e2etest",
                  "realName":"REALNAME-SECRET-E2E"},   ← 真名，匿名可见
   "acceptedNumber":1,"submissionNumber":2,"mood":"probe"},
  {"id":1,"user":{"id":2,"username":"student",
                  "realName":"Phase 2 Student"},       ← 真名，匿名可见
   "acceptedNumber":1,"submissionNumber":5,"mood":null},
  ...],"total":5}}
```

```
$ GET /api/messages                     (cookie: e2etest)
[200]
{"data":{"results":[{"id":1,
  "sender":{"id":2,"username":"student","realName":"Phase 2 Student"},  ← 旧后端此处为 null
  ...}]}}
```

**影响**：`GET /api/rankings/users` 这一条最严重 —— **匿名 + 一个 GET 就能拿到
"用户名 ↔ 真实姓名"的全量映射表**，把原本半匿名的排行榜变成了实名榜。
中职学生属未成年人，这是实打实的 PII 外泄面扩大。

**做对了的反例**（说明这不是"整体没设计"，而是漏了）：
`routes/contest.ts:209` 是**唯一**做了门控的地方，与旧后端语义一致：

```ts
user: { id: user.id, username: user.username, realName: admin ? realName : null },
```

`routes/problem.ts:333`、`routes/account.ts:94`、`routes/contest.ts:34`、
`routes/problemset.ts:62` 硬编码 `realName: null`，也是对的。
所以修复方式很清楚：把上表 8 处对齐成 `contest.ts:209` 那种写法。

---

#### I-3. 本人提交详情返回 `info`（逐测试点判题明细）与 `ip`，旧后端对所有非管理员都隐藏

**位置**：`apps/api/src/routes/submission.ts:187`、`:195`、`:199`

```ts
// submission.ts:187
const full = isAdminRole(user) || row.submission.userId === user.id
//                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 旧后端没有这个分支
return submissionDetailSchema.parse({
  ...
  info: full ? row.submission.info : {},      // :195
  ip: full ? row.submission.ip : null,        // :199
```

**旧后端**（`submission/views/oj.py:96`）：

```python
if request.user.is_admin_role():
    submission_data = await self.async_serialize_data(SubmissionModelSerializer, submission)
else:
    submission_data = await self.async_serialize_data(SubmissionSafeModelSerializer, submission)
```

而 `SubmissionSafeModelSerializer`（`submission/serializers.py`）：

```python
class Meta:
    model = Submission
    exclude = ("info", "contest", "ip")
```

判定条件是 **`is_admin_role()`**，不是"是不是自己的提交"。
所以旧后端下，学生看**自己的**提交也拿不到 `info` 和 `ip`。

**实际响应**（`student` 看自己的提交）：

```
$ GET /api/submissions/LEAKPROBE-SUB-PRIVATE    (cookie: student，本人)
[200]
{"data":{"id":"LEAKPROBE-SUB-PRIVATE","userId":2,"username":"student",
  "code":"...","result":0,
  "info":{"err":null,"data":[
     {"error":0,"memory":7991296,"output":null,"result":0,"signal":0,
      "cpu_time":3,"exit_code":0,"real_time":6,
      "test_case":"1",                                    ← 测试点编号
      "output_md5":"caf1a3dfb505ffed0d024130f58c5cfa"},   ← 输出指纹
     {..."test_case":"2","output_md5":"248e844336797ec98478f85e7626de4a"},
     {..."test_case":"3","output_md5":"ab233b682ec355648e7891e66c54191b"},
     {..."test_case":"4","output_md5":"cfee398643cbc3dc5eefc89334cacdc1"},
     {..."test_case":"5","output_md5":"bc6dc48b743dc5d013b1abaebd2faed2"}]},
  "ip":"10.9.8.7",                                        ← 旧后端不返回
  ...}}
```

**影响**：学生能看到本题**测试点总数、每个测试点的编号、单点耗时/内存/退出码，
以及自己输出的 md5**。这不等于直接泄题（`output` 字段是空的，且 md5 是学生自己程序的输出，
不是标准答案），但它把判题内部结构暴露给了学生：
反复提交 + 比对 `output_md5` 可以**逐测试点二分定位哪一个点挂了**，
这正是旧后端把 `info` 关掉想避免的事。

**分级说明**：按你给的口径，"测试点/答案泄露给学生 → Critical"。
我定 Important 而非 Critical，理由是：泄露的是**测试点元信息 + 学生自己输出的指纹**，
不含标准答案、不含测试点输入输出内容，也不含 `test_case_id`（拿不到测试数据目录）。
但它确实越过了旧白名单，且方向是"学生本可以不知道的判题内部"，
所以我建议按 Critical 的优先级排期修，只是不按 Critical 定级。

**已做对的部分**：看**他人**提交时 `full` 为 false，`info` 返回 `{}`、`ip` 返回 `null` ——
实测确认（见下），这部分与旧后端一致。

```
$ GET /api/submissions/LEAKPROBE-SUB-SHARED    (cookie: leakprobe2，他人)
[200]
{"data":{...,"userId":2,"username":"student",
  "code":"SECRET-CODE-OF-OTHER-USER-SHARED",   ← shared=true，旧后端同样返回，属预期
  "info":{},"ip":null,                          ← 正确置空
  "shared":true,...}}
```

---

### Minor

---

#### M-1. `GET /api/messages` 的 `submission` 内嵌多出 `info` / `ip` 两个字段名（值恒为空）

**位置**：`apps/api/src/routes/content.ts:96`、`:100`

```ts
info: {},     // content.ts:96
ip: null,     // content.ts:100
```

旧 `MessageSerializer.submission` 用的是 `SubmissionSafeModelSerializer`，
`info` / `contest` / `ip` 三个键**根本不出现**。新后端硬编码成空值后仍把键留在响应里。

**实际响应**：

```
$ GET /api/messages    (cookie: e2etest)
{"data":{"results":[{"id":1,"sender":{...},"message":"LEAKPROBE msg",
  "submission":{"id":"2e16...","userId":2,"username":"student",
    "code":"n = int(input())\nprint(...)",
    "info":{},        ← 键存在，值为空
    "ip":null,        ← 键存在，值为空
    ...}}],"total":1}}
```

**无数据泄露**（值恒为空，写死在代码里，不读数据库）。仅为白名单形状不一致。
之所以还是列出来，是因为它和 I-3 共用 `submissionDetailSchema` ——
如果将来有人"顺手"把这里改成传真实值，就会变成真泄露。

（`submission.code` 出现在这里是**旧后端也有的**：旧 `SubmissionSafeModelSerializer`
的 `exclude` 不含 `code`。消息由 super admin 发出，指向收件人自己的提交，属预期。）

---

#### M-2. `GET /api/problem-sets/:id/user-progress` 返回学生 `realName`

**位置**：`apps/api/src/routes/problemset.ts:398`

旧 `ProblemSetProgressSerializer.user = UsernameSerializer()`（`problemset/serializers.py:248`）
→ `real_name` 恒为 `null`。新后端返回真实值。

单列为 Minor 而不并入 I-2，是因为**该端点已由 `isTeacherOrAbove(user)` 门控**
（`problemset.ts` 里 `if (!isTeacherOrAbove(user)) return failure(c, 403, ...)`，
实测普通学生调用返回 403），受众只有教师。给教师看学生真名大概率是**产品上想要的**。
所以：**先确认这是不是有意为之**，如果是，就别跟着 I-2 一起改，
否则会把教师端的功能删掉。

---

#### M-3. `GET /api/tutorials/:id/exercises` 返回练习答案 —— 与旧后端一致，**不是回归**

**位置**：`apps/api/src/routes/content.ts:207`

```ts
const rows = await db.select().from(schema.exercise).where(...)
return success(c, rows.map((row) => exerciseSchema.parse({
  id: row.id, type: row.type, data: objectValue(row.data), order: row.order,
})))
```

`data` 是 jsonb 原样透传（`contract/src/content.ts:72` 是
`z.record(z.string(), z.unknown())`，不裁剪内容）。

**实际响应**（**匿名也能拿**）：

```
$ GET /api/tutorials/1/exercises    (no cookie)
[200]
{"data":[{"id":1,"type":"mcq","data":{
   "answer":1,                                      ← 正确答案
   "options":["1","2"],"question":"1+1?",
   "explanation":"SECRET-ANSWER-EXPLANATION"},      ← 答案解析
  "order":1}]}
```

**旧后端完全一样**（`tutorial/serializers.py`）：

```python
class ExerciseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Exercise
        fields = ["id", "type", "data", "order"]     # data 整个 jsonb 出去
```

且旧 `ExerciseAPI`（`tutorial/views/oj.py`）也没有 `@login_required`。

**结论：行为一致，不算本次重写引入的问题。** 之所以写进报告，是因为这是教程练习的
**前端判题设计**（答案下发到浏览器、客户端比对），学生 F12 就能看到答案。
迁移不需要动它，但如果哪天想改判题方式，这是已知的口子 —— 属于遗留设计债，不是回归。

---

## 4. 静态检查结果：11 处"选全部列"逐条核实

`db.select()`（不跟对象字面量，等价 `SELECT *`）全部命中如下。
**结论：11 处全部无泄露** —— 每一处的查询结果都只是中间变量，
真正进响应的是后面手写的显式字段映射 + Zod `.parse()`。

| # | 文件:行 | 选了哪张表 | 表里有敏感列吗 | 是否泄露 | 依据 |
|---|---|---|---|---|---|
| 1 | `routes/contest.ts:70` | `contest` | **有 `password`** | **否** | 结果传给 `serializeContest()`（`contest.ts:37`），只挑 11 个字段；`password` 仅用于 `contestType: contest.password ? "Password Protected" : "Public"`（`:49`）。实测 `GET /api/contests` 响应无 `password` 键 |
| 2 | `routes/content.ts:207` | `exercise` | `data` 含答案 | 否（但见 M-3） | 只取 `id/type/data/order`，与旧 `ExerciseSerializer` 字段完全一致 |
| 3 | `routes/problemset.ts:85` | `problemset_progress` | 无 | 否 | 结果只用于取 `completedProblemsCount` / 算 `progressSummary()` |
| 4 | `routes/problemset.ts:86` | `problemset_badge` | 无 | 否 | 结果传给 `badgeData()`（`problemset.ts:66`），显式挑 8 个字段 |
| 5 | `routes/problemset.ts:123` | `problemset` | 无 | 否 | 传给 `serializeProblemSet()`；旧 `ProblemSetListSerializer` 也含 `visible`，属对齐 |
| 6 | `routes/problemset.ts:133` | `problemset` | 无 | 否 | 同上 |
| 7 | `routes/problemset.ts:361` | `problemset_badge` | 无 | 否 | 传给 `badgeData()` |
| 8 | `routes/achievement.ts:43` | `achievement` | 隐藏成就的 `name`/`description`/`threshold` | **否** | `achievement.ts` 里按 `masked = achievement.hidden && !record` 把 `name` 换成 `"???"`、`description` 换成 `"达成条件保密"`、`metric`/`operator`/`threshold`/`progress` 全置 `null` |
| 9 | `routes/achievement.ts:44` | `user_achievement` | 无 | 否 | 只用来建 `Map` 判断是否已解锁 |
| 10 | `services/contest.ts:40` | `contest` | **有 `password`** | **否** | `findVisibleContest()` 是内部 helper，返回值不直接进响应；调用方（`contest.ts:79/85/97/114`）都再走 `serializeContest()` |
| 11 | `services/achievements.ts:27` | `achievement` | 同 #8 | 否 | 后台解锁判定用，不进任何 HTTP 响应 |

**#8 的实证**（隐藏成就掩码生效）：

```
$ GET /api/achievements    (cookie: e2etest)
{"data":{"username":"e2etest","achievements":[
  {"id":1,"name":"LEAKPROBE ach","description":"d",...,"unlocked":true,...},
  {"id":2,"name":"???","description":"达成条件保密",       ← 掩码生效
   "icon":"noto:red-question-mark","rarity":"gold","hidden":true,
   "metric":null,"operator":null,"threshold":null,          ← 达成条件全部置空
   "unlocked":false,"progress":null,"unlockRate":0}]}}
```
（造数据时该成就的真实 `name` 是 `LEAKPROBE hidden SECRETNAME`、
`description` 是 `SECRET-CONDITION`，两个标记值在响应里 grep 均为 0 命中。）

**#1 / #10 的实证**（比赛密码不泄露）：

```
$ GET /api/contests?limit=50    (no cookie)
{"data":{"results":[
  {"id":3,"title":"LEAKPROBE contest","description":"desc","tag":"probe",
   "startTime":"...","endTime":"...","createTime":"...","lastUpdateTime":"...",
   "createdBy":{"id":1,"username":"devadmin","realName":null},
   "status":"0","contestType":"Password Protected"},      ← 只暴露"有没有密码"
  {"id":4,...,"contestType":"Public"}],"total":2}}
```
真实密码 `SUPERSECRET-CONTEST-PW` 在 `GET /api/contests`、`GET /api/contests/:id`、
`GET /api/contests/:id/access`、`POST /api/contests/:id/access`（成功与失败两种）
五个响应里 grep 均为 **0 命中**。未通过密码校验时 `/problems`、`/rank`、`/submissions`
全部 403，通过后才放行 —— 与旧后端 `@check_contest_permission` 行为一致。

**唯一的整行展开**（`routes/problem.ts:228`）：

```ts
return success(c, rows.map((row) => yearlyAcSchema.parse({ ...row, acRate: ... })))
```

`rows` 来自 `db.select({ year: ..., total: count(), accepted: ... })` 的显式聚合投影，
不是表行，`...row` 只有 3 个数值键。`yearlyAcSchema` 又会 strip 掉多余键。**无泄露。**

---

## 5. 核实过、确认没问题的端点

以下端点的**每一个字段**都比对过旧 serializer 白名单，无越界、无敏感值。

**题目类**（旧基准：`ProblemListSerializer` / `ProblemSerializer` / `ProblemSafeSerializer`）
- `GET /api/problems`、`GET /api/problems/:displayId`
  —— 无 `answers` / `astRules` / `testCaseId` / `testCaseScore`；`hasAstRules` 只给布尔值。
    实测拿真实题目 `1002`（其 `answers` 列存着完整 C + Python 参考解）验证：
    响应里 grep `#include<stdio.h>` / `scanf(` / `printf(` / `//PREPEND` / `//APPEND`
    **全部 0 命中**，`template` 只有 `//TEMPLATE` 区间的内容。
    顺带一提：旧 `ProblemSerializer.Meta.exclude` **没有**排掉 `ast_rules`，
    也就是旧后端其实会把 AST 规则发给学生 —— **新后端这里比旧的更严，是改进，不是问题**。
- `GET /api/problems/random`、`/similar`、`/yearly-ac`、`/rank`、`/:id/beat-count`、`/:id/reaction`
- `GET /api/problem-tags`、`GET /api/problem-authors`
- `GET /api/contests/:id/problems`、`GET /api/contests/:id/problems/:displayId`
  —— 比赛进行中正确按 `ProblemSafeSerializer` 语义把 `difficulty` 置 `""`、
    `submissionNumber` / `acceptedNumber` 置 `0`、`statisticInfo` 置 `{}`。

**提交类**（旧基准：`SubmissionListSerializer`）
- `GET /api/submissions`、`GET /api/submissions/today-count`
  —— 列表无 `code` / `info` / `ip`，与旧 `exclude = ("info", "contest", "code", "ip")` 一致。
- `GET /api/submissions/:id` 的**权限判定**：未 share 且题目未开 `share_submission` → 404；
  匿名 → 401；开了 `share_submission` 或 `shared=true` → 放行。与旧 `check_user_permission` 等价。
- `GET /api/contests/:contestId/submissions`

**比赛类**：`GET /api/contests`、`/:id`、`/:id/access`、`/:id/rank`、`POST /:id/access`
（`/:id/rank` 的 `realName` 已正确门控，见 I-2 反例）

**题单类**：`GET /api/problem-sets`、`/:id`、`/:id/problems`、`/:id/badges`、
`/:id/user-progress`（见 M-2）、`GET /api/users/:username/badges`、
`POST|PUT /api/problem-set-progress`

**成就类**：`GET /api/achievements`、`/summary`、`/pending`、`POST /achievements/pending/read`

**班级/排行类**：`GET /api/rankings/activity`、`/rankings/classes`、`GET /api/me/class-rank`、
`GET /api/classes/:className/usernames`、`POST /api/classes/comparison`
—— 只返回用户名和聚合统计，无 `realName` / `email`。匿名可访问，
但旧 `ClassRankAPI` / `ClassPKAPI` 同样没有 `@login_required`，**属对齐**。

**AI 类**：`GET /api/ai/detail`、`/duration`、`/heatmap`、`/login-summary`、`/pinned`
—— 另外确认：带 `?username=student` 请求 `/ai/detail`，响应里的 `"user"` 仍是 `"e2etest"`，
说明 `targetUser()` 对普通学生忽略了该参数，**没有越权看他人 AI 报告**。

**内容类**：`GET /api/announcements`、`/:id`、`GET /api/tutorials`、`/:id`、
`GET /api/messages`（见 I-2 / M-1）

**流程图类**：`GET /api/flowcharts`、`/:id`、`GET /api/problems/:id/flowchart/current`、`/history`
—— 他人流程图返回 404（用 `leakprobe2` 实测）。

**账号/站点类**
- `POST /api/auth/login` → `{"data":{"ok":true}}`（不回显用户信息）
- `POST /api/users`（注册）→ `{"data":{"ok":true}}`
- `DELETE /api/auth/session`、`POST /api/me/avatar`、`POST /api/me/problem-display-ids/refresh`
- `GET /api/me` → 返回自己的 `email` / `realName`，**正常**（旧后端 `show_real_name=True`）
- `PUT /api/me/profile` → 同 `GET /api/me`，**正常**（旧 `ProfileAPI.put` 也是 `show_real_name=True`）
- `GET /api/site` → 只有 `websiteBaseUrl` / `websiteName` / `websiteNameShortcut` /
  `websiteFooter` / `allowRegister` / `submissionListShowAll` / `classList` / `enableMaxkb`，
  无 SMTP、无 judge token
- `GET /api/quotes/random`、`GET /api/users/:id/metrics`

### 顺带提一句：新后端比旧后端裁剪更严的地方

按你的要求，这些不算 finding，但列出来供你确认前端会不会缺字段：

1. **`problem.ast_rules`**：旧 `ProblemSerializer` 没排掉它，学生能拿到 AST 规则原文；
   新后端只给 `hasAstRules: boolean`。**新的更安全**，但如果 ojnext 有地方读
   `ast_rules` 的具体内容（比如提示"必须用 for 循环"），需要补个专门的字段。
2. **`GET /api/tutorials/:id` 的 `createdBy`**：旧 `TutorialSerializer` 用的是
   `UserSerializer`，**会带 `email`**；新后端只给 `{id, username, realName}`。
   **新的更安全**，前端应该用不到教程作者的邮箱。

---

## 6. 需要你确认的一件事（环境影响）

评审造数据时，脚本的 `select * from problem order by id limit 1` 选中了
**题目 id=2（`_id` 1001，"🐟三天打鱼两天晒网"）**，并覆写了它的
`ast_rules`、`answers`、`test_case_score`、`template` 四列，用来验证这些字段会不会外泄。
**原值没有备份，已丢失。**

清理时按同类题目的形状还原成了：

```
template        = {}                                    (与覆写前实测值一致，这个是准的)
ast_rules       = null                                  (id 3/4/5 等题目均为 null)
answers         = []
test_case_score = [{"score":20,"input_name":"1.in","output_name":"1.out"}, ... 共 5 项]
                  (照抄 id=4/5 的形状；该题 test_case_id 目录下无 info 文件可查真实点数)
```

其余改动**已完整还原**：`problem 5.share_submission` 回 `false`、
user 2/4 的 `class_name` 回 `null`、user 4 的 `real_name` 回 `null`、
所有 `submission.ip` 回 `null`。造的行（比赛/题单/教程/练习/公告/成就/消息/
流程图/比赛排名/两条 LEAKPROBE 提交/三个 leakprobe 账号）**已全部删除**，
最终库状态：20 道题、8 条提交、3 个用户（devadmin / student / e2etest）、其余业务表为空。

`answers` 和 `test_case_score` 影响的是**评测与题解**，不影响本次结论。
但**题目 1001 是学生做的第一题**，如果这台机器上的数据之后还要用，
建议从生产重新导一次该题，或至少确认 1001 的测试点数确实是 5。

---

## 7. 修复优先级建议

| 优先级 | Finding | 一句话改法 |
|---|---|---|
| 1 | I-1 | `routes/account.ts:101` 的 `optionalAuth` → `requireAuth` |
| 2 | I-2 | 上表 8 处按 `contest.ts:209` 的写法补门控；`rankings/users` 最急 |
| 3 | I-3 | `submission.ts:187` 的 `full` 去掉 `\|\| row.submission.userId === user.id`，只留 `isAdminRole(user)` |
| 4 | M-1 | 给 `submissionDetailSchema` 拆一个不含 `info` / `ip` 的 safe 变体，`content.ts` 的 messages 用它 |
| 5 | M-2 | 先确认是不是产品有意为之，是就不动 |
| — | M-3 | 与旧后端一致，本次迁移不动 |
