# 阶段 3 权限与鉴权边界评审

日期：2026-08-07
受审对象：`apps/api`（Hono + Bun），oj 侧 65 条端点
参照基准：`../OnlineJudge`（Django + DRF，只读）
工作清单：`docs/specs/phase3-coverage.md` 的「oj 侧逐条对照」表
验证方式：逐条读源码 + 对本机 `http://localhost:3000` 实跑（测试账号 `e2etest`，普通学生）

---

## 1. 结论摘要

**3 条 Critical，2 条 Important，4 条 Minor。**

整体上权限骨架是**忠实重建**的：比赛的 `check_contest_permission`（含密码保护、未开始拦截、contest admin 豁免、ProblemSafeSerializer 的字段脱敏）、提交的 `check_user_permission`、流程图的所有者判断、角色判定函数（`is_admin_role` / `is_teacher_or_above` / `is_contest_admin`）都与旧后端逐行等价，实跑验证也全部对上。**我事先怀疑的四处里有三处是误判**——`GET /contests/:id`、`GET /classes/:className/usernames`、`GET /users/:id/metrics` 在旧后端本来就是无鉴权的，新后端没有放宽；判题机心跳也确实做了 token 校验，只是校验用的密钥有问题。

真正的问题集中在**"序列化层的隐式权限"**：旧后端把权限判断藏在 DRF 序列化器的默认参数里（`UsernameSerializer(need_real_name=False)`、`UserProfileAPI` 开头的 `is_authenticated` 短路），新后端重写时只搬了装饰器、没搬序列化器里的这层，于是**真实姓名和邮箱被无差别下发给未登录访客**。学生是中职生（未成年人），真名 + 用户名 + 班级可以直接拼出花名册，这是本次最严重的问题。

另有一处逻辑翻转：`submission_list_show_all=false` 时，**未登录用户能拿到全站提交列表，而登录的学生拿到空列表**——匿名比登录更有权限。

---

## 2. 逐条对照表（只列有差异的行）

未列出的条目 = 新旧权限要求一致，见第 4 节。

| # | 旧端点 | 旧权限要求 | 新路由 | 新权限实现 | 判定 |
|---|---|---|---|---|---|
| 1 | `account/profile`（GET） | 视图首行 `if not user.is_authenticated: return success()` —— 等价 `@login_required` | `GET /profiles/:username` | `optionalAuth`，无任何 user 判断 | **更松（Critical）** |
| 2 | `account/user_rank` | 无装饰器，但 `RankInfoSerializer → UsernameSerializer(need_real_name=False)` 恒返回 `real_name: null` | `GET /rankings/users` | 无中间件，`realName: profile.realName` 无条件下发 | **更松（Critical）** |
| 3 | `submission/submissions` | 无装饰器；`not show_all and user.is_regular_user()` —— 匿名走到这行会 `AttributeError`（Django `AnonymousUser` 无该方法），必定拿不到数据 | `GET /submissions` | `optionalAuth`；`isRegularUser(null) === false` → 守卫不生效，直接返回全量 | **更松（Critical）** |
| 4 | `announcement/announcement` | `AnnouncementSerializer.created_by = UsernameSerializer()` → `real_name: null` | `GET /announcements`、`GET /announcements/:id` | `createdBy.realName` 无条件下发（content.ts:43、64） | **更松** |
| 5 | `contest/contests`、`contest/contest` | `ContestSerializer.created_by = UsernameSerializer()` → `null` | `GET /contests`、`GET /contests/:id` | `creator()` 返回 realName（contest.ts:31-34 → :47） | **更松** |
| 6 | `problem/problem`（列表与详情） | `ProblemListSerializer.created_by = UsernameSerializer()` → `null` | `GET /problems`、`GET /problems/:displayId/similar` | `listItem()` 下发 realName（problem.ts:86） | **更松** |
| 7 | `problem/contest/problem` | 同上 | `GET /contests/:id/problems`、`.../:displayId` | contest.ts:131、:177 下发 realName | **更松** |
| 8 | `problemset/problemset`、`/<id>`、`/<id>/problems` | `UsernameSerializer()` → `null` | `GET /problem-sets*` | problemset.ts:62、:169 下发 realName | **更松** |
| 9 | `problemset/<id>/users_progress` | `@teacher_admin_required` + `ProblemSetProgressSerializer.user = UsernameSerializer()` → **即使教师也拿不到 real_name** | `GET /problem-sets/:id/user-progress` | `requireAuth` + `isTeacherOrAbove`（角色判断一致），但 problemset.ts:398 下发 realName | 角色一致，字段**更松** |
| 10 | `message/message`（GET） | `@login_required` + `sender = UsernameSerializer()` → `null` | `GET /messages` | `requireAuth`（一致），content.ts:85 下发 `sender.realName` | 角色一致，字段**更松** |
| 11 | `tutorial/tutorial` | 无装饰器；`created_by = UserSerializer()`（**含 email**，无 real_name） | `GET /tutorials/:id` | 无中间件；`createdBy.realName` 下发，不含 email | realName **更松** / email **更严** |
| 12 | `conf/judge_server_heartbeat/` | 无装饰器，校验 `sha256(SysOptions.judge_server_token)`；env 缺失时回落到 `rand_str()`（随机、fail-safe） | `POST /judge-server/heartbeat` | 校验 `sha256(config.judgeServerToken)`；env 缺失时回落到硬编码常量 `"oj2-dev-token"`（fail-open） | **更松（Important）** |
| 13 | `submission/submission`（POST） | `@login_required` + `TokenBucket` 用户级限流（`SysOptions.throttling`） | `POST /submissions` | `requireAuth`，**无限流** | **更松（Important）** |
| 14 | `conf/class_usernames` | 无装饰器，`classroom` 参数无格式校验 | `GET /classes/:className/usernames` | 无中间件，但加了 `^\d{3,4}$` 校验 | **更严** |
| 15 | 全部需登录端点 | 装饰器内 `if request.user.is_disabled: return error` | 所有路由 | `getUserByToken` 发现 `isDisabled` 直接删 session 并返回 null | **更严**（禁用即时踢线） |

---

## 3. Findings

### Critical

---

#### C1 — `GET /api/profiles/:username` 未登录即可读取任意用户完整档案（含邮箱）

**位置**：`apps/api/src/routes/account.ts:101-108`（`optionalAuth`）
**服务层**：`apps/api/src/services/profile.ts:6-41`
**旧后端**：`OnlineJudge/account/views/oj.py:38-41`

```python
async def get(self, request, **kwargs):
    user = request.user
    if not user.is_authenticated:
        return self.success()          # ← 匿名直接返回空，等价 @login_required
```

新后端只用了 `optionalAuth`，handler 内部**没有任何** `c.get("user")` 判断，`getUserProfileById` 的第二参数只控制 `realName` 是否下发，其余字段（含 `email`）无条件返回。

**实跑证据**（无 cookie）：

```
$ curl -s http://localhost:3000/api/profiles/e2etest
{"data":{"id":2,"user":{"id":4,"username":"e2etest","email":"e2e@local.test",
"adminType":"Regular User","problemPermission":"None",
"createTime":"2026-08-07 07:19:10.789+00","lastLogin":"2026-08-07 07:25:35.98+00",
"openApi":false,"isDisabled":false,"className":null},
"realName":null,"acmProblemsStatus":{"problems":{"5":{"_id":"1004","status":0}}},
"avatar":"/public/avatar/default.png","blog":null,"mood":"probe",
"github":null,"school":null,"major":null,"language":null,
"acceptedNumber":1,"submissionNumber":2}}
```

**复现**：`curl http://localhost:3000/api/profiles/<任意用户名>`，不带 Cookie。

**影响**：泄露邮箱、账号角色（`adminType` 可用于定位管理员账号做定向爆破）、最后登录时间、班级、全部做题记录。配合同样无鉴权的 `GET /classes/:className/usernames`（可枚举整班用户名，旧后端同样开放），可无凭据批量拉取全校师生的邮箱与角色。

---

#### C2 — 真实姓名（`realName`）被无条件序列化，未登录即可读取学生真名

**最严重实例**：`apps/api/src/routes/account.ts:168`（`GET /rankings/users`，无任何中间件）

```ts
user: { id: user.id, username: user.username, realName: profile.realName },
```

**旧后端**：`OnlineJudge/account/serializers.py:145-150` + `OnlineJudge/utils/api/_serializers.py:9-14`

```python
class RankInfoSerializer(serializers.ModelSerializer):
    user = UsernameSerializer()        # ← need_real_name 默认 False

class UsernameSerializer(serializers.Serializer):
    def get_real_name(self, obj):
        return obj.userprofile.real_name if self.need_real_name else None
```

旧后端把"是否下发真名"做成了序列化器的**默认关闭开关**，全仓库 11 处 `UsernameSerializer(...)` 调用里只有 1 处显式打开（`contest/serializers.py:84`，且条件是 `is_contest_admin`）。新后端没有对应机制，凡是 join 到 `user_profile` 的地方就直接把 `realName` 塞进响应。

**实跑证据**（先给 `e2etest` 写入真名，再无 cookie 请求，最后已还原为 NULL）：

```
$ curl -s "http://localhost:3000/api/rankings/users?limit=5"
{"data":{"results":[
  {"id":2,"user":{"id":4,"username":"e2etest","realName":"张三(审计测试)"},
   "acceptedNumber":1,"submissionNumber":2,"mood":"probe"},
  {"id":1,"user":{"id":2,"username":"student","realName":"Phase 2 Student"},
   "acceptedNumber":1,"submissionNumber":5,"mood":null}, ...]}}
```

`student` 这条是**本机既有数据**，没有经过我任何修改，其 `real_name = "Phase 2 Student"` 直接被匿名请求读到。

**同一根因的全部下发点**（旧后端对应字段一律为 `null`）：

| 文件:行 | 路由 | 是否匿名可达 |
|---|---|---|
| `routes/account.ts:168` | `GET /rankings/users` | **是**（学生真名，危害最大） |
| `routes/content.ts:43` | `GET /announcements` | 是 |
| `routes/content.ts:64` | `GET /announcements/:id` | 是 |
| `routes/content.ts:196` | `GET /tutorials/:id` | 是 |
| `routes/contest.ts:34`（`creator()`，经 :47） | `GET /contests`、`GET /contests/:id` | 是 |
| `routes/problem.ts:86`（`listItem()`） | `GET /problems`、`GET /problems/:displayId/similar` | 是 |
| `routes/problemset.ts:62`（`problemSetCreator()`） | `GET /problem-sets`、`GET /problem-sets/:id` | 是 |
| `routes/problemset.ts:169` | `GET /problem-sets/:id/problems` | 是 |
| `routes/contest.ts:131` | `GET /contests/:id/problems` | 需登录 + 过密码 |
| `routes/contest.ts:177` | `GET /contests/:id/problems/:displayId` | 需登录 + 过密码 |
| `routes/content.ts:85` | `GET /messages`（`sender.realName`） | 需登录 |
| `routes/problemset.ts:398` | `GET /problem-sets/:id/user-progress` | 需教师 |

注：`routes/problem.ts:333`（`GET /problems/:displayId`）和 `routes/contest.ts:209`（比赛榜单，`admin ? realName : null`）是**正确**的两处，说明这套逻辑并非无人知晓，只是没有被统一执行。

**建议**：在 `sampleUserSchema` 层面把 `realName` 变成必须显式打开的字段（例如收敛成一个 `serializeUserRef(user, { realName: boolean })` 帮助函数），而不是在 13 个调用点分别记得置 null。

---

#### C3 — `submission_list_show_all=false` 时，未登录用户能读全站提交列表，登录学生反而读不到

**位置**：`apps/api/src/routes/submission.ts:211`

```ts
if (!(await getBooleanOption("submission_list_show_all", true)) && isRegularUser(user)) {
  return success(c, submissionListSchema.parse({ results: [], total: 0 }))
}
```

`isRegularUser` 定义于 `routes/helpers.ts:27-29`：`user?.adminType === "Regular User"`。**匿名用户 `user === null` → 返回 `false` → 守卫短路，全量下发。**

**旧后端**：`OnlineJudge/submission/views/oj.py:149-151`

```python
show_all = await SysOptions.aget("submission_list_show_all")
if not show_all and request.user.is_regular_user():
    return self.success({"results": [], "total": 0})
```

Django 的 `AnonymousUser` 没有 `is_regular_user` 方法（`account/models.py:53` 定义在自定义 `User` 上），匿名请求走到这行会抛 `AttributeError` → 500。旧后端在这个配置下**绝不可能**把列表交出去。

**实跑证据**（临时插入 `options_sysoptions` 行，测完已 DELETE 还原）：

```
site.submissionListShowAll = false
ANON              /submissions?limit=2  ->  total=7  n=2   ← 未登录，拿到全部 7 条
REGULAR logged-in /submissions?limit=2  ->  total=0  n=0   ← 登录学生，拿到 0 条
```

匿名响应含每条提交的 `username`、题号、语言、结果、耗时。

**复现**：把 `options_sysoptions` 中 `submission_list_show_all` 置为 `false`，然后不带 Cookie 请求 `GET /api/submissions?limit=10`。

**影响**：该开关的唯一用途就是"考试期间不让学生互相看提交"。现在学生只要开一个隐私窗口（或直接删 Cookie）就能绕过，开关等于失效。

---

### Important

---

#### I1 — 判题机共享密钥的默认值硬编码在仓库里（fail-open）

**位置**：`apps/api/src/config.ts:8`

```ts
judgeServerToken: process.env.JUDGE_SERVER_TOKEN ?? "oj2-dev-token",
```

`.env.example:4` 同样写着 `JUDGE_SERVER_TOKEN=oj2-dev-token`。

**旧后端**：`OnlineJudge/options/options.py:92-94`

```python
def default_token():
    token = os.environ.get("JUDGE_SERVER_TOKEN")
    return token if token else rand_str()      # ← 没配就随机，fail-safe
```

生产 compose（`OnlineJudge/docker-compose.yml:44,65`）显式注入 `_Mam^^1rvC86Qko2d0`。也就是说旧后端**漏配环境变量的后果是判题机连不上（立刻暴露）**，新后端**漏配的后果是任何人都能通过心跳校验（静默）**。

**实跑证据**：

```
no-token           -> 403 {"error":{"code":"invalid-judge-token",...}}   ← 校验存在，符合旧行为
default-dev-token  -> 200 {"error":null,"data":null}                     ← 用仓库里的常量即通过
```

（本机确实跑在默认 token 下。测试插入的 `hostname='pwned-by-audit'` 行已删除。）

**当前实际影响有限**：`judge/run.ts:69` 派发判题用的是 `config.judgeServerUrl`（环境变量），**不读** DB 里的 `service_url`，所以伪造心跳无法把判题流量劫走，只能污染 `judge_server` 表 / 管理端仪表盘。但这是运气好，不是设计使然——`service_url` 字段被写进了库（judge-server.ts:63），一旦将来 admin 侧或调度器改成读它，同一个洞就升级为 Critical。

**建议**：`JUDGE_SERVER_TOKEN` 缺失时启动即 fail（或生成随机值并打日志），不要留可猜的默认值。

---

#### I2 — `POST /submissions` 丢失了提交限流

**位置**：`apps/api/src/routes/submission.ts:52`（只有 `requireAuth`）
**旧后端**：`OnlineJudge/submission/views/oj.py:35-42`、`:68-70`

```python
def throttling(self, request):
    user_bucket = TokenBucket(key=str(request.user.id), redis_conn=cache,
                              **SysOptions.throttling["user"])
    can_consume, wait = user_bucket.consume()
    if not can_consume:
        return "Please wait %d seconds" % (int(wait))
```

旧配置 `{"capacity": 20, "fill_rate": 0.03}` ≈ 每用户约 2 提交/分钟。新后端没有任何等价物，任一登录学生可以无限速向 `judgeQueue` 灌任务。这不是读权限问题，但它是旧后端里唯一挡住"一个学生打爆判题沙箱"的机制，重写时整体丢失了，归入本报告以免遗漏。

---

### Minor

**M1 — `isAdminRole` 从白名单退化为黑名单**
`routes/helpers.ts:31-33`：`Boolean(user && user.adminType !== "Regular User")`。
旧：`account/models.py:65-70` 显式列举 `[STUDENT_ADMIN, TEACHER_ADMIN, SUPER_ADMIN]`。
当前四种角色下两者等价，但将来新增任何角色（如"助教""家长"）都会**默认获得 admin 权限**，包括 `canViewSubmission` 里的"看所有人代码"。建议改回白名单。

**M2 — 比赛权限判断没有中间件兜底**
`canAccessContest` 在 `contest.ts:116/144/193`、`submission.ts:63/253` 共 5 处手工调用。旧后端用 `@check_contest_permission` 装饰器，漏挂会很显眼；新后端漏调一次就是静默放行，且 `GET /contests/:id/problems` 这类路由挂的是 `optionalAuth`（本身不拦人），从中间件列表上完全看不出它受保护。目前 5 处都调对了，属可维护性风险。

**M3 — `blog` / `github` 从 URLField 降级为自由字符串**
`packages/contract/src/account.ts:15,17` 用 `z.string().max(256)`；旧 `account/serializers.py:125,127` 是 `serializers.URLField`。现在 `PUT /me/profile` 可以写入 `javascript:alert(1)` 之类的值，是否可利用取决于前端如何渲染这两个字段。

**M4 — `GET /dev/problems` 仍在线且无鉴权**
`routes/problem.ts:231`。内容本身是公开题目摘要，无实际泄露，但它是阶段 1 的临时端点，`phase3-coverage.md` 第 120 行已标注应删除，至今还挂在生产路由树上。

**（文档纠错，非安全问题）** `phase3-coverage.md:96` 把 `PUT submissions/:id` 描述为"判题结果写回"。实际实现（`submission.ts:301-316`）是**提交分享开关**，对应旧 `SubmissionAPI.put` + `ShareSubmissionSerializer`。判题结果写回走的是内部 worker，不经 HTTP。这条描述会让人误以为存在一个需要判题机凭据的写入端点，建议改正。

---

## 4. 核实过、确认没有问题的项

以下是逐条读过源码（多数还实跑过）、确认**新后端权限要求与旧后端等价或更严**的部分。

**四个预先怀疑点里的三个是误判：**

- `GET /contests/:id`（contest.ts:78）——旧 `ContestAPI.get`（`contest/views/oj.py:38-51`）本来就**没有任何装饰器**，公开可读。新后端行为一致，且 `serializeContest` 不下发 `password`（旧 `ContestSerializer` 亦 `exclude`）。**真正受保护的比赛内容（题目、榜单、提交）全部走 `canAccessContest`，实跑验证如下：**

  ```
  ANON     /contests/5           200   ← 与旧后端一致
  ANON     /contests/5/problems  401 login-required
  ANON     /contests/5/rank      401 login-required
  ANON     /contests/5/submissions 401 login-required
  ANON     /contests/5/access    401 login-required
  AUTHnopw /contests/5/problems  403 wrong-password    ← 登录但没过密码，正确拦截
  AUTHnopw /contests/5/rank      403 wrong-password
  ```
  （测试用的密码保护比赛 id=5 已删除。）

- `GET /classes/:className/usernames`（site.ts:36）——旧 `ClassUsernamesAPI`（`conf/views.py:237-243`）无装饰器，公开。新后端一致，且**多加了** `^\d{3,4}$` 格式校验。属旧后端遗留的开放面，不是本次重写引入的（但确实是 C1 的放大器，值得单独排期收口）。

- `GET /users/:id/metrics`（account.ts:140）——旧 `Metrics`（`account/views/oj.py:66-83`）无装饰器，按 `?userid=` 任取，也不限制只查自己。新后端一致。同上，属遗留开放面。

- `POST /judge-server/heartbeat`——token 校验**存在**且用了 `timingSafeEqual`，比旧后端的裸字符串比较更好；问题只在默认值（见 I1）。

**比赛权限（最复杂的一块，逐条对齐）：**

- `canAccessContest`（`services/contest.ts:45-63`）与 `check_contest_permission._check_access`（`account/decorators.py:122-136`）逐行等价：未登录 → login-required；contest admin 豁免；密码保护校验 session 内存的密码；`check_type != "details"` 时拦截未开始的比赛。
- `checkContestPassword`（`services/contest.ts:28-37`）完整复刻了 `sig#timestamp` 形式（`decorators.py:87-110`），含 sha256 前 8 位与过期判断。
- `contestDetailsAllowed`（`services/contest.ts:24-26`）= `Contest.problem_details_permission`（`contest/models.py:42-43`）。
- 比赛未结束时对非管理员脱敏的字段集完全一致：`difficulty`、`submissionNumber`、`acceptedNumber`、`statisticInfo` 被置空 —— 正是旧 `ProblemSafeSerializer`（`problem/serializers.py:211-228`）exclude 的那几个（`answers` 新后端从不下发）。
- 比赛榜单 `realName` 正确地由 `admin ? realName : null` 控制（contest.ts:209），对齐 `ACMContestRankSerializer(is_contest_admin=...)`。
- `POST /submissions` 的比赛分支完整保留了"比赛已结束禁止提交"和 `allowedIpRanges` 白名单（submission.ts:65-68 vs `submission/views/oj.py:47-53`）；`ipAllowed`（services/contest.ts:71-85）的 CIDR 计算正确，空列表放行、无 IP 拒绝。
- `GET/POST /contests/:id/access` 均要求登录且比赛必须设了密码，与旧 `ContestAccessAPI` / `ContestPasswordVerifyAPI`（均 `@login_required`）一致。

**提交与流程图的所有者判断：**

- `canViewSubmission`（submission.ts:166-178）与 `Submission.check_user_permission`（`submission/models.py:47-56`）等价，且新增了 `if (!user) return false` —— 更严。
- `check_share=False` 语义（用于分享开关和 `canUnshare`）正确传递。
- `GET /submissions/:id` 用 `requireAuth`，无权限时返回 404 而非 403，不泄露存在性 —— 比旧的 "No permission for this submission" 更严。
- `PUT /submissions/:id`（分享开关）保留了"比赛进行中不得分享"。
- 流程图 `canView`（flowchart.ts:24-26）= `FlowchartSubmission.check_user_permission`（`flowchart/models.py:59-63`）；列表的 `myself` / `username` / 普通用户默认只看自己 三段逻辑与 `flowchart/views/oj.py:78-83` 一致；`current` / `history` 强制 `userId = 自己`。

**角色与身份：**

- `isRegularUser` / `isAdminRole` / `isTeacherOrAbove` / `isSuperAdmin`（helpers.ts:27-41）与 `account/models.py:53-73` 语义一致（`isAdminRole` 的黑名单写法见 M1）。
- `isContestAdmin`（services/contest.ts:20-22）= `User.is_contest_admin`（`account/models.py:78-79`）。
- 禁用账号：`getUserByToken`（auth/session.ts:105-108）发现 `isDisabled` 立即删除 session 并返回 null，比旧后端"每个装饰器里各判一次"更彻底。
- Session token 用 `randomBytes(32)` + Redis，Cookie `httpOnly` + `SameSite=Lax`，登出正确删 Redis key 与 Cookie。

**逐条确认权限一致的端点：**

- `POST /auth/login`、`DELETE /auth/session`、`POST /users`（注册）、`GET /me` —— 均与旧后端一致（`GET /me` 匿名返回 null，对应旧 `UserProfileAPI` 匿名返回空）。注册同样受 `allow_register` 控制；`rawPassword` 明文留存是旧 `User.set_password`（`account/models.py:81-83`）就有的行为，非新增。
- `PUT /me/profile` 可写字段集与旧 `EditUserProfileSerializer` **完全相同**（8 个字段，无 `acceptedNumber` 等统计字段），无字段注入面。
- `POST /me/avatar`、`POST /me/problem-display-ids/refresh`、`GET /problems/:displayId/rank`、`GET /me/class-rank` —— `requireAuth`，且只操作 `c.get("user")!.id`，无越权参数。
- 成就四条（achievement.ts:39/75/103/111）—— 均 `requireAuth`；`?username=` 允许查他人，**与旧 `_resolve_user`（`achievement/views/oj.py:10-15`，`?name=`）完全一致**，不是新放宽；`pending` / `pending/read` 强制本人。隐藏成就的掩码逻辑也保留了（不下发 metric/threshold/progress）。
- AI 九条 —— 全部 `requireAuth`；`targetUser`（ai.ts:45-59）正确复刻了"仅 teacher_or_above 才能用 `?username=` 查他人"（`ai/views/oj.py:239-244`）；`/ai/class-pk-analysis` 保留 `isTeacherOrAbove`（对齐 `@teacher_admin_required`）；`/ai/hint` 强制提交必须属于本人，且系统提示词明确禁止透露参考答案。
- `GET /messages` 只查 `recipientId = 自己`；`POST /messages` handler 内 `isSuperAdmin` 判断，对齐 `@super_admin_required`。
- 表情 `GET/POST /problems/:id/reaction` —— `requireAuth`，且 POST 要求该题有 AC 记录才能表态。
- 题单：`/problem-sets*` 全部过滤 `visible=true AND status != 'draft'`；`POST/PUT /problem-set-progress` 只改自己的进度，且 PUT 校验 submission 归属本人 + 已 AC + 题目确在题单内；`/problem-sets/:id/user-progress` 角色判断与 `@teacher_admin_required` 一致。
- 公开内容（`GET /announcements*`、`/tutorials*`、`/problem-tags`、`/problems/random`、`/problem-authors`、`/problems/:displayId/yearly-ac`、`/problem-sets/:id/badges`、`/site`、`/quotes/random`、`/submissions/today-count`、`/rankings/activity`、`/rankings/classes`、`/classes/comparison`）—— 旧后端对应视图**同样无装饰器**，一致。`/problem-authors?all=1` 能看到不可见题目的作者名，旧 `ProblemAuthorAPI`（`problem/views/oj.py:248`）行为相同。
- 公告 / 教程 / 题单 / 题目查询一律带 `visible` / `is_public` / `status != draft` 过滤，无隐藏内容泄露。
- WebSocket `/ws/submissions`（index.ts:71-83、websocket.ts）—— 升级前强制校验 session；订阅 topic 按 `userId` 隔离；`subscribe` 消息查库时带 `eq(userId, ws.data.userId)`，无法订阅他人提交；推送前二次校验账号未禁用。**无越权面。**
- 头像静态服务（index.ts:53-68）对路径做了 basename 校验，无目录穿越。

**Hono 路由注册顺序**已核：`/problems/random`、`/problems/:id/beat-count`、`/submissions/today-count` 等具体路径均注册在同前缀的 `:param` 路由之前，不存在鉴权路由被无鉴权通配路由抢先匹配的情况。

---

## 5. 测试期间对本机数据库的改动（均已还原）

| 操作 | 还原情况 |
|---|---|
| `user_profile.real_name` 设为 `'张三(审计测试)'`（user_id=4）、`'李老师(审计)'`（author） | 已置回 NULL / 原值 |
| `options_sysoptions` 插入 `submission_list_show_all=false` | 已 DELETE（该键原本不存在） |
| `judge_server` 插入 `hostname='pwned-by-audit'` | 已 DELETE |
| `contest` 插入密码保护比赛（id=5） | 已 DELETE，验证过 0 行 |

未执行任何 `DROP` / `TRUNCATE`；未修改 `OnlineJudge/`、`ojnext/` 或 OJ2 的任何源码；未改动 git 状态。
