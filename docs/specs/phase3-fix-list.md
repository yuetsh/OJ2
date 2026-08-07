# 阶段 3 修复清单（两份评审合并）

日期：2026-08-07
来源：`phase3-review-authz.md`（权限边界）+ `phase3-review-leakage.md`（数据泄露）
受审代码：commit `8c00cdc`，oj 侧 65 个端点

> ## 状态：Critical / Important 已修复并复评通过；7 条 Minor 已于 2026-08-07 全部处理（见文末）
>
> 修复提交：`b4b61af` / `8237909` / `b7adf29` / `f548aef`
> 复评报告：`phase3-review-rereview.md` —— 8 条（F1-F6 + 收尾的 F4b、F5b）**全部 ADDRESSED**，
> 修复 diff 内无新引入破坏。
>
> 复评补上了控制方没验充分的一条：**F4b 的 `contestId`**。控制方当时用的提交本就不属于比赛，
> `contestId` 天然为 null，运行时证据不成立。复评真造了一条比赛提交（`contestId=7`、`ip` 有值），
> 确认数据库存的是真值、而 API 返回给提交者本人的是 `info:{}` / `ip:null` / `contestId:null`。
>
> 复评另核实：`sampleUser()` 是真正的默认关闭开关（覆盖全部 14 个下发点，含本清单未列的
> rankings 与题目列表/详情）；`isRegularUser` 全仓确实只有一个调用点；`.env` 加载器的优先级
> 正确（真实环境变量 > cwd 的 .env > 仓库根 .env），畸形行不崩、缺文件静默跳过；限流参数
> `fill_rate=0.03` 与旧后端 `options/options.py` 逐值吻合，且拦截位置与
> `submission/views/oj.py` 一致（比赛权限校验之后、取题目之前）。

## 合并说明

两份评审独立进行、互不知情，却各自命中了同两条问题（`/profiles/:username` 匿名可读、
`realName` 无条件下发）。**独立复现提高了可信度**，此处合并为一条。

两份评审对同一问题的严重度判定不一致时，**取更严的一方**。理由：使用者是中职学生（未成年人），
姓名、邮箱、班级属于个人信息，泄露的后果不由技术标准衡量。

控制方（本文档作者）已对 F1、F2、F3 独立实跑复现，证据附在各条下。

---

## F1 —— 匿名可读任意用户完整档案 【Critical】

- **位置**：`apps/api/src/routes/account.ts:101`（路由）、`apps/api/src/services/profile.ts:19`（字段）
- **两份评审均命中**：authz C1 / leakage I-1
- **问题**：`GET /profiles/:username` 只挂 `optionalAuth`，handler 内无登录判断，匿名可读
  `email`、`adminType`、`problemPermission`、`isDisabled`、`className`、`lastLogin`
- **旧后端行为**：`OnlineJudge/account/views/oj.py` 的 `UserProfileAPI.get` 第一行即
  `if not user.is_authenticated: return self.success()` —— 匿名直接返回空
- **放大效应**：用户名可经 `GET /rankings/users` 公开枚举，因此可无 cookie 批量收集
  全校学生的邮箱与最后登录时间

**控制方实跑证据**：
```
匿名 GET /api/profiles/e2etest -> 200
含 email: true | 含 adminType: true | 含 realName: true
{"user":{"username":"e2etest","email":"e2e@local.test","adminType":"Regular User",
 "problemPermission":"None","lastLogin":"...","isDisabled":false,"className":"2301"}}
```

**修法**：handler 开头判断未登录即返回空，对齐旧行为。

---

## F2 —— 学生真名无条件下发 【Critical】

- **位置**：13 个下发点，其中 8 个匿名可达；`apps/api/src/routes/account.ts:168` 为典型
- **两份评审均命中**：authz C2 / leakage I-2
- **问题**：旧后端将「是否返回真名」设计为 DRF `UsernameSerializer(need_real_name=False)` 的
  **默认关闭**开关，全仓 11 处调用中仅比赛榜单一处显式打开。新后端未搬运这一层，真名随
  用户对象无条件下发
- **唯一做对的地方**：`apps/api/src/routes/contest.ts:209`

**控制方实跑证据**：
```
匿名 GET /api/rankings/users -> 200
[{"user":{"id":4,"username":"e2etest","realName":"..."},...},
 {"user":{"id":2,"username":"student","realName":"Phase 2 Student"},...}]
```
（`"Phase 2 Student"` 为本机既有数据，非评审探针造出）

**修法**：在用户对象的序列化层加一个默认关闭的 `includeRealName` 开关，逐个下发点显式开启；
默认不给。**不要逐处删字段** —— 那样下次新增端点会重犯。

---

## F3 —— 匿名绕过提交可见性守卫，权限大于登录用户 【Critical】

- **位置**：`apps/api/src/routes/submission.ts:211`、`apps/api/src/routes/helpers.ts:27`
- **来源**：authz C3（leakage 未覆盖）
- **问题**：
  ```ts
  export function isRegularUser(user: AuthUser | null | undefined) {
    return user?.adminType === "Regular User"      // isRegularUser(null) === false
  }
  // submission.ts:211
  if (!(await getBooleanOption("submission_list_show_all", true)) && isRegularUser(user)) {
    // 限制为只看自己的提交
  }
  ```
  匿名用户的 `isRegularUser(null)` 为 `false`，守卫整体短路，限制不生效
- **潜伏性**：`submission_list_show_all` 默认为 `true`，该分支平时不执行，**开关一旦关闭立即暴露**。
  而关闭这个开关的典型场景正是考试

**控制方实跑证据**（临时把开关置 false，测后已还原）：
```
匿名     total = 10      ← 全部可见
登录学生 total = 0       ← 被正确限制
```

**修法**：守卫应为「非管理员即受限」，而非「是普通用户才受限」。匿名必须落入受限分支。
建议改用 `!isAdminRole(user)`（该函数对 null 返回 `false`，语义正确）。

---

## F4 —— 自己的提交详情返回判题内部信息与 IP 【Important】

- **位置**：`apps/api/src/routes/submission.ts:187`
- **来源**：leakage I-3
- **问题**：返回 `info`（含每个测试点的 `test_case` 编号与 `output_md5`）与 `ip`
- **旧后端行为**：这两个字段以 `is_admin_role()` 把关，而非「是不是自己的提交」
- **风险**：测试点编号与输出 md5 可用于反推测试数据规模与部分答案特征

**修法**：`info` 与 `ip` 改为仅管理员可见，对齐旧后端。

---

## F5 —— 判题机 token 默认值硬编码进仓库 【Important】

- **位置**：`docker/compose.dev.yml` 的 `${OJ2_JUDGE_TOKEN:-oj2-dev-token}` 及后端读取处
- **来源**：authz Important
- **问题**：token 校验本身实现正确（用了 `timingSafeEqual`），但缺省值 `"oj2-dev-token"`
  写死在仓库里。旧后端在 env 缺失时用 `rand_str()` fail-safe，宁可不可用也不用弱默认值
- **当前影响有限**：`judge/run.ts` 用 env 里的 URL 而非数据库中的 `service_url`

**修法**：去掉默认值，env 缺失时启动失败或生成随机值，不要静默使用弱默认。

---

## F6 —— 提交接口缺少限流 【Important】

- **位置**：`apps/api/src/routes/submission.ts` 的 `POST /submissions`
- **来源**：authz Important
- **问题**：旧后端有 TokenBucket 限流，新后端未搬运
- **风险**：判题沙箱是有限资源，学生（或脚本）可连续提交打满队列

**修法**：按旧后端的限流参数重建。

---

## Minor（共 7 条）—— 2026-08-07 已全部处理

在 admin 侧开工前清掉，避免同样的模式被复制 42 次。逐条结论：

| 编号 | 内容 | 处理 |
|---|---|---|
| authz M1 | `isAdminRole` 从白名单退化为黑名单 | **改回白名单**（`ADMIN_ROLES` / `TEACHER_ROLES` 显式列举，对齐 `account/models.py:65-73`）。实测四种已知角色行为不变，而虚构的新角色「助教」现在默认**不是**管理员——黑名单写法下它会默认拿到管理员权限 |
| authz M2 | 比赛权限判断没有中间件兜底 | **新增 `requireContestAccess(checkType, paramName)` 中间件**（`services/contest.ts`），把「取比赛 → 404 → 鉴权 → 401/403」收进路由注册行。手工调用点从 5 处降到 2 处：`GET /contests/:id/access` 是**报告**权限而非强制（不能 403），`POST /submissions` 的比赛 id 来自请求体、中间件跑时 body 还没解析，两处都就地写了说明 |
| authz M3 | `blog` / `github` 从 URLField 降级为自由字符串 | **加回 URL 校验**（只放行 `http(s)://`，空串表示清空）。实测 `javascript:alert(1)` 与 `not a url` 均 400，`https://example.com/x` 与空串 200 |
| authz M4 | `GET /dev/problems` 仍在线且无鉴权 | **已删除**（连同 `dev-problems.vue`、路由项、`problemSummarySchema`），实测 404 |
| 文档纠错 | `phase3-coverage.md` 把 `PUT submissions/:id` 写成「判题结果写回」 | **已改正**为「提交分享开关」，并注明判题结果写回走内部 worker 不经 HTTP |
| leakage M-1 | 站内信内嵌的 submission 多出 `info` / `ip` 两个空键 | **新增 `embeddedSubmissionSchema`**（`omit` 掉 `info`/`ip`/`contestId`），不再复用 `submissionDetailSchema` 传空值——形状对上了，将来有人把空值改成真值也不会变成泄露。实测三个键均已消失 |
| leakage M-2 | `problem-sets/:id/user-progress` 返回学生 `realName` | **无需改动**：F2 的 `sampleUser()` 默认关闭开关已经覆盖此处，现在返回 `null`，与旧后端 `UsernameSerializer()` 一致。报告提的「别把教师端功能删掉」的顾虑不成立——旧后端本来就不给 |
| leakage M-3 | `tutorials/:id/exercises` 下发练习答案 | **不改**：旧后端逐字相同（`ExerciseSerializer` 整个 `data` jsonb 出去，且无 `@login_required`）。这是教程练习「答案下发到浏览器、客户端比对」的既有设计，属遗留设计债，不是本次重写引入的回归。要改得连判题方式一起改，不在迁移范围内 |

### 顺带修掉的一个真回归（评审未覆盖）

`GET /api/messages` 内嵌的 submission 原本给的是 `problemId`（数字主键），而旧后端
`SubmissionSafeModelSerializer` 的 `problem` 是 `SlugRelatedField(slug_field="_id")`，
即**展示用题号**。`oj/user/message.vue:20` 拿它拼 `/problem/<题号>` 链接，迁移后拼出的是
`/problem/undefined`，题号那一栏也是空的。已改为下发 `problem`（展示题号），实测返回 `"1004"`。

---

## 评审确认没有问题的部分

两份评审各自独立核实、结论一致的部分：

- **无任何敏感字段泄露**：`raw_password`、`password`、`auth_token`、`open_api_appkey`、
  `session_keys` 在 111 个请求的响应中零命中（含明文密码值的全文 grep）
- **无泄题**：`answers`、`ast_rules`、`test_case_id`、`test_case_score` 均未泄露，
  已在 `answers` 含完整 C/Python 参考解的题目 1002 上专项验证
- **模板隐藏区正确剥离**
- **`contest.password` 未泄露**
- **11 处 `db.select()` 选全列的写法全部后接显式字段映射 + Zod strip，无一泄露**
- **比赛权限是重建得最好的一块**：`sig#timestamp` 密码、未开始拦截、`ProblemSafeSerializer`
  脱敏字段集逐行对齐，五个端点实跑全部正确拦截
- 覆盖面：111 个请求，65 个 oj 路由中 61 个取得 2xx

---

## 附带需处理：本地样本数据受损

泄露评审的种子脚本覆盖了**题目 1001（`problem.id=2`）**的 `ast_rules`、`answers`、
`test_case_score`、`template`，原值已丢失（评审用兄弟题目的值做了近似填充，当前
`answers` 为 `[]`）。导入用的 `/tmp/problems.csv` 也已不存在。

影响：本地样本数据的价值在于真实（真实富文本、LaTeX、中文最能暴露序列化问题），
1001 现已失真。

处理：需要时从生产重新导出该行：
```bash
docker exec oj-postgres psql -U onlinejudge -d onlinejudge -c \
  "\copy (SELECT * FROM problem WHERE _id='1001') TO STDOUT WITH CSV HEADER" > p1001.csv
```
不紧急 —— 其余 19 道题未受影响。
