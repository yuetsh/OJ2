# 阶段 4 后台接口权限边界评审

评审对象：`apps/api/src/routes/admin/*.ts`（10 个文件、86 个 handler）+ 3 个挂在 `/admin` 之外但对应旧后端 admin 视图的端点。
参照物：`OnlineJudge/` 各 app 的 `views/admin.py`，装饰器定义在 `account/decorators.py`。
评审范围：**只看角色守卫与归属校验**，不评审风格 / 性能 / 可维护性。

- 评审人：独立安全评审
- 日期：2026-08-07
- 实跑环境：`http://localhost:3000`，postgres 5433 / redis 6380
- 实跑账号：`student`(id=2)、`e2etest`(id=4)，测试期间临时提权，**结束后已全部还原为 Regular User / None**；造的 6 道题、3 场比赛、2 个题单、1 个奖章、1 个标签已全部删除，`problem` 表回到 20 行

---

> **修复记录（2026-08-07，本文档之后）**
>
> C1、C2、I1、I2、I3、I4 **六条全部已修**，并用两个教师账号（互相不可见的题单/比赛）
> 实跑复验通过：跨题单删奖章 → 404 且对方奖章还在；跨租户 make-public → 404；
> from-public 拖别人的赛题 → 400 `not-a-public-problem`；克隆比赛回传 `password: null`；
> 分析接口移到 `/admin/problem-analytics/*` 后不再被 `/problems/:id` 遮蔽；
> upload-image 守卫收回 `requireAdmin`。
>
> Minor 四条未修：M1 已按「有意偏离」保留，M2/M3/M4 留待阶段 5。

## 结论速览

| 级别 | 数量 | 条目 |
|---|---|---|
| Critical | 2 | C1 跨题单删奖章会连带删掉别人的 user_badge；C2 make-public 无归属校验且回传完整题面 |
| Important | 4 | I1 两个 requireTeacher 端点被 `/problems/:id` 路由遮蔽；I2 from-public 不校验源题归属；I3 克隆比赛不校验归属且回传明文密码；I4 upload-image 守卫比旧后端严过头，教师/学生管理员写题面时会 403 |
| Minor | 4 | M1 visibility 的归属规则与 canEdit 不一致；M2 from-public 的错误码构成比赛存在性预言机；M3 三个 admin 端点的守卫写在 handler 里而非注册行；M4 禁用账号落到 401 而不是「账号已禁用」 |

守卫覆盖：**86 个后台 handler 全部挂了守卫，没有一个漏挂**。角色档位与旧后端装饰器逐条比对后全部一致（见文末对照表）。问题全部集中在**对象级归属校验**这一层。

---

## Critical

### C1 — 跨题单删奖章：奖章保住了，但别人的 user_badge 被真删了

**文件**：`apps/api/src/routes/admin/problemset.ts:365-378`

```ts
const deleted = await db.transaction(async (tx) => {
  await tx.delete(schema.userBadge).where(eq(schema.userBadge.badgeId, badgeId))   // ← 先删，没带题单条件
  return tx.delete(schema.problemsetBadge).where(and(
    eq(schema.problemsetBadge.id, badgeId),
    eq(schema.problemsetBadge.problemsetId, row.id),                                // ← 后校验
  )).returning({ id: schema.problemsetBadge.id })
})
if (deleted.length === 0) return failure(c, 404, "badge-not-found", "奖章不存在")
```

父子归属校验放在了子表清理**之后**，而且 `if (deleted.length === 0)` 的 404 是在事务**提交之后**才返回的 —— 回调正常结束，事务照常 COMMIT。于是「奖章没删成」和「奖章的获得记录已经删光了」同时成立。

这正是任务里点名要查的场景：**A 题单的 id + B 题单的奖章 id**。

**旧后端对应行为**：`problemset/views/admin.py:287-301`，先 `ProblemSetBadge.objects.get(id=badge_id, problemset=problem_set)`，取不到直接 `return self.error("奖章不存在")`，`badge.delete()` 根本不会执行，user_badge 一行不动。

**实跑验证**

前置：`student`(A) 与 `e2etest`(B) 均为 Teacher Admin/Own。A 建题单 2，B 建题单 3 并在其下建奖章 2。手工插入两行 user_badge：

```
docker exec oj2-postgres psql ... -tAc "insert into user_badge (user_id,badge_id,earned_time) values (4,2,now()),(2,2,now()); select id,user_id,badge_id from user_badge"
INSERT 0 2
2|4|2
3|2|2
```

A（只拥有题单 2）打 B 的奖章 2：

```
DELETE /api/admin/problem-sets/2/badges/2      (cookie = A)
→ 404 {"error":{"code":"badge-not-found","message":"奖章不存在"}}
```

看起来被挡住了。查库：

```
select count(*) from user_badge;             → 0
select id,problemset_id,name from problemset_badge;  → 2|3|REVIEW-B-BADGE
```

奖章还在，**两行 user_badge 全没了**。

对照：同一路由的 PUT 是安全的（校验和写在同一条 `and()` 里）：

```
PUT /api/admin/problem-sets/2/badges/2   body={name:"HACKED",...}   (cookie = A)
→ 404 badge-not-found
GET /api/admin/problem-sets/3/badges     (cookie = B)
→ 200 [{"id":2,"name":"REVIEW-B-BADGE","conditionValue":1,...}]     # 未被篡改
```

**风险场景**：教师 A 在自己题单页面点删除奖章时，前端只要拼错 badgeId（或 A 手工构造请求），就能把教师 B 班上全体学生已获得的奖章记录一次性抹掉，而 A 自己看到的是「奖章不存在」——**破坏是静默的，没有任何一方会收到提示**。奖章记录没有别处备份，`recalculateBadge` 只在改奖章时触发，B 不改奖章就永远恢复不了 earnedTime。

**修法**：把 `userBadge` 的清理条件收进子查询，或把归属校验提到事务最前面并在不匹配时 `throw` 触发回滚。

---

### C2 — `make-public` 完全不校验归属，且把整份题面回传给越权者

**文件**：`apps/api/src/routes/admin/problem.ts:491-533`

```ts
adminProblemRoutes.post("/problems/:id/make-public", requireProblemPermission, async (c) => {
  ...
  const [problem] = await db.select().from(schema.problem).where(eq(schema.problem.id, id)).limit(1)
  if (!problem) return failure(c, 404, "problem-not-found", "Problem does not exist")
  if (!problem.contestId || problem.isPublic) { ... }
  // ↑ 这里之后直接开事务，没有 canEdit / ownedBy
  ...
  return success(c, await serialize(created), 201)   // ← 回传完整题面
})
```

同一文件里 `GET /problems/:id`(275)、`PUT`(323)、`DELETE`(371)、`/test-cases`(602)、`/sql-scripts`(628) 全都过了 `canEdit`，唯独这一条没有。

**旧后端对应行为**：`problem/views/admin.py:456-483` 的 `MakeContestProblemPublicAPIView` 同样没有 `ensure_created_by` —— **这个洞是从旧后端继承来的**。但旧后端第 483 行是 `return self.success()`，**不回传任何数据**；转出来的公开题 `created_by` 仍是原作者且 `visible=False`，越权者拿不到内容。新后端第 532 行 `return success(c, await serialize(created), 201)` 把 description、samples、testCaseId、**answers（标准答案）** 一起吐回去，**泄露面严格大于旧后端**。

**实跑验证**

A 建比赛 3（A 所有）并在其中建比赛题 38。B 直接读该题：

```
GET /api/admin/problems/38                       (cookie = B)
→ 404 {"error":{"code":"problem-not-found","message":"Problem does not exist"}}   # 归属校验生效
```

B 换成 make-public：

```
POST /api/admin/problems/38/make-public   body={"displayId":"STOLEN1"}   (cookie = B)
→ 201 {"data":{"id":39,"_id":"STOLEN1","title":"REVIEW A","description":"<p>d</p>",
       "inputDescription":"i","outputDescription":"o","samples":[{"input":"1","output":"1"}],
       "testCaseId":"reviewdummy00000000000000000000",
       "testCaseScore":[{"score":100,"input_name":"1.in","output_name":"1.out"}],
       "hint":"","languages":["Python3"],"template":...
```

同一个人、同一道题，读接口 404、写接口 201 并把题面全给了。副作用还有两条：A 的比赛题被改成 `isPublic=true`（A 之后再想正常转公开会被 409 "Already be a public problem" 挡住），以及库里多出一道 A 名下的公开题。

**风险场景**：比赛开始前，任意持有 problem_permission 的管理员（含 Student Admin）遍历 problem id 就能把别人未开赛比赛的题面连同标准答案全部拖走。中职学校场景下这就是考前泄题。

**修法**：在 496 行之后补 `if (!(await canEdit(user, problem)))` → 404；顺带把 `problem.contestId` 分支的成功响应改成不回传题面（或至少 omit `answers`）。

---

## Important

### I1 — `/problems/stuck` 与 `/problems/ac-trend` 被 `/problems/:id` 遮蔽，两个 requireTeacher 端点实际不可达

**文件**：`apps/api/src/routes/admin/tag.ts:190`、`tag.ts:215`（被 `apps/api/src/routes/admin/problem.ts:275` 遮蔽）；成因在 `apps/api/src/routes/admin/index.ts:30-32`（`adminProblemRoutes` 先于 `adminTagRoutes` 注册）

Hono 按注册顺序匹配，`GET /problems/:id` 的 `:id` 会吃掉 `stuck` / `ac-trend` 这两个字面段。于是：

- 生效的守卫是 `requireProblemPermission`（problem.ts:275），**不是** tag.ts 上写的 `requireTeacher`
- handler 也是 problem.ts 的，`queryInteger("stuck", 0, {min:1})` 回落到 0，查不到题 → 404
- tag.ts:190 / 215 的两个 handler **一次都没被执行过**

**旧后端对应行为**：`problem/views/admin.py:638-640`（`StuckProblemsAPI.get` `@teacher_admin_required`）与 `675-677`（`TopACTrendAPI.get` `@teacher_admin_required`），两条独立 URL，正常可达。

**实跑验证**（用 problem_permission 做判别，因为两个守卫的档位不同）

`student` = Teacher Admin + `problem_permission='None'`。按 tag.ts 写的 `requireTeacher` 应当放行；按 problem.ts 的 `requireProblemPermission` 应当 403：

```
GET /api/admin/problems/stuck      → 403 {"error":{"code":"permission-denied","message":"权限不足"}}
GET /api/admin/problems/ac-trend   → 403 {"error":{"code":"permission-denied","message":"权限不足"}}
GET /api/admin/contests            → 200 {"data":{"results":[],"total":0}}      # requireTeacher 确实放行
```

判定：跑的是 `requireProblemPermission`，即 problem.ts:275。

把权限补回 `Own`、再提到 Super Admin，两条依旧是 problem.ts 的错误体：

```
GET /api/admin/problems/stuck      (Teacher/Own)   → 404 {"code":"problem-not-found","message":"Problem does not exist"}
GET /api/admin/problems/ac-trend   (Teacher/Own)   → 404 {"code":"problem-not-found","message":"Problem does not exist"}
GET /api/admin/problems/stuck      (Super Admin)   → 404 {"code":"problem-not-found","message":"Problem does not exist"}
```

**风险场景**：当前只是「两个教师功能死了 + 挂的守卫不是实际生效的守卫」。真正的隐患在于**注册行上写的守卫和实际执行的守卫不一致**——`index.ts:15-21` 的注释明确说「不在总入口兜一层，就是为了让守卫从注册行上看得出来」，这条遮蔽正好打破了那个前提。将来若有人放宽 `GET /problems/:id`，会连带把两个 teacher-only 的统计接口一起放宽，而 tag.ts 上的 `requireTeacher` 看着还是对的。

**修法**：把 tag.ts 的两条静态路由挪到 problem.ts 的 `/problems/:id` 之前注册（调整 index.ts 顺序，或把它们改成 `/problem-stats/stuck` 这类不冲突的路径）。

---

### I2 — `from-public` 只校验目标比赛归属，不校验源题归属，可把别人的比赛题拖进自己的比赛

**文件**：`apps/api/src/routes/admin/problem.ts:535-580`

```ts
const [contest] = await db.select().from(schema.contest).where(eq(schema.contest.id, contestId)).limit(1)
const [problem] = await db.select().from(schema.problem)
  .where(eq(schema.problem.id, parsed.data.problemId)).limit(1)          // ← 任意 id，无过滤
if (!contest || !problem) return failure(c, 404, "not-found", ...)
if (user.adminType !== "Super Admin" && contest.createdById !== user.id) {  // ← 只校验比赛
  return failure(c, 404, "contest-not-found", "Contest does not exist")
}
```

源题既不校验 `createdById`，也不校验 `visible`，更不限制 `contestId is null`（尽管路由叫 from-**public**）。拷贝出来的题落在调用者自己的比赛里，之后 `canEdit` 走「比赛题看比赛创建者」分支 → 调用者对它有完全读写权。

**旧后端对应行为**：`problem/views/admin.py:486-511` 的 `AddContestProblemAPI.post` —— **一个装饰器都没有，也没有任何 ensure_created_by**，比新后端还宽（连管理员身份都不要求）。新后端补上了 `requireProblemPermission` + 比赛归属，是净收紧；但对象级的源题归属仍然缺失。

**实跑验证**

A 的公开题 37（A 所有）、A 的比赛题 38（在 A 的比赛 3 里）。B 建自己的比赛 5：

```
POST /api/admin/contests/5/problems/from-public  {"problemId":37,"displayId":"X1"}   (cookie = B)
→ 201 {"data":{"id":40,"_id":"X1","title":"REVIEW REVIEWA1","description":"<p>d</p>",...}}

POST /api/admin/contests/5/problems/from-public  {"problemId":38,"displayId":"X2"}   (cookie = B)
→ 201 {"data":{"id":41,"_id":"X2","title":"REVIEW A","description":"<p>d</p>",
       "testCaseId":"reviewdummy00000000000000000000",...}}

GET  /api/admin/problems/41                                                          (cookie = B)
→ 200 {"data":{"id":41,"_id":"X2","title":"REVIEW A",...}}     # 复制品 B 完全可读可改
```

问题 38 是 A 的**比赛题**，B 直读它是 404（见 C2 实跑），经这条路径拷一份就拿到了。

**风险场景**：与 C2 同源 —— 考前拖走别人比赛的题面与标准答案，只是入口换成了「往自己比赛里加题」。

**修法**：源题至少要求 `contestId is null`（名副其实的 public）；理想情况再叠一层 `canEdit(user, problem) || problem.visible`。

---

### I3 — 克隆比赛不校验归属，且响应里回传原比赛的明文密码

**文件**：`apps/api/src/routes/admin/contest.ts:172-233`（`password: original.contest.password` 在 192 行，`serialize` 下发 `password` 在 49 行）

```ts
adminContestRoutes.post("/contests/:id/clone", requireTeacher, async (c) => {
  const [original] = await selectContest(id)
  // 克隆不要求 ownedBy：旧后端这里也没有 ensure_created_by，教师可以拿别人的比赛做模板。
  // 克隆出来的归调用者所有、且默认不可见，所以不构成越权修改。
  if (!original) return failure(c, 404, "contest-not-found", "Contest does not exist")
```

注释对「不构成越权**修改**」的判断是对的，但漏了越权**读取**：克隆会把原比赛的全部题目连同 `password` 一起复制进调用者名下的新比赛，调用者随后对这些题有完整读写权。

**旧后端对应行为**：`contest/views/admin.py:265-301` 的 `ContestCloneAPI.post`，`@teacher_admin_required`，确实没有 `ensure_created_by`，也照样 `password=original.password`。**行为等价**；但旧的 `ContestAdminSerializer` 同样下发 password，所以泄露面一致，属于原样继承的洞。

**实跑验证**

A 建密码保护赛 3（password=`secret123`，visible=true）。B 直读被拦：

```
GET /api/admin/contests/3          (cookie = B)  → 404 contest-not-found
PUT /api/admin/contests/3          (cookie = B)  → 404 contest-not-found
GET /api/admin/contests/3/problems (cookie = B)  → 404 contest-not-found
GET /api/admin/contests/3/acm-helper (cookie=B)  → 404 contest-not-found
```

B 克隆：

```
POST /api/admin/contests/3/clone   (cookie = B)
→ 201 {"data":{"id":4,"title":"REVIEW-CONTEST-A","description":"d","tag":"t",
       "startTime":"2026-08-07 23:19:29.475+00","endTime":"2026-08-08 00:19:29.475+00",
       ...,"password":"secret123"
```

四条读接口全 404，克隆一次全拿到，外加明文密码。

**风险场景**：任一 Teacher Admin 可在开赛前克隆同事的比赛，读全部题面，并拿到密码直接以学生身份进原赛。

**修法**：至少不要把 `password` 复制到克隆件、也不要在克隆响应里回传；更彻底的做法是给 clone 加 `ownedBy`（会改变旧行为，需要产品确认「拿别人比赛当模板」是不是真需求）。

---

### I4 — `POST /upload-image` 收成 Super Admin，教师/学生管理员写题面时会 403

**文件**：`apps/api/src/routes/admin/conf.ts:206`

```ts
adminConfRoutes.post("/upload-image", requireSuperAdmin, async (c) => {
```

**旧后端对应行为**：`utils/views.py:13-16` 的 `SimditorImageUploadAPIView.post` —— **完全没有装饰器**（`utils/urls.py:6` 挂在 `api/admin/upload_image`），任何人包括匿名都能传图。新后端收成 Super Admin 是必要的修补，但收过头了。

前端 `ojnext/src/admin/api.ts:159-163` 的 `uploadImage` 被 `MarkdownEditor.vue` / `TextEditor.vue` 调用，而这两个编辑器出现在：

- `src/admin/problem/detail.vue` —— 题目编辑页，`requireProblemPermission` 档位，Student Admin 就能进
- `src/admin/contest/detail.vue` —— 比赛编辑页，`requireTeacher` 档位
- `src/admin/announcement/detail.vue`、`src/admin/tutorial/detail.vue` —— 这两个确实是 Super Admin

**实跑验证**（`e2etest` = Teacher Admin/Own）

```
POST /api/admin/upload-image     (cookie = Teacher Admin)
→ 403 {"error":{"code":"permission-denied","message":"权限不足"}}
```

**风险场景**：不是越权，是**可用性回归**——教师往比赛描述里插图、学生管理员往题面里插图，都会静默失败。这类问题在权限评审里要一起提，因为「修法」是调守卫档位。

**修法**：改成 `requireAdmin`（三种管理员均可）。上传目录是服务端生成文件名、限了后缀和 10MB，风险可控。

---

## Minor

### M1 — `PUT /problems/:id/visibility` 的归属规则与 `canEdit` 不一致，比赛题上会反转

**文件**：`apps/api/src/routes/admin/tag.ts:173-186`

```ts
if (!canManageAllProblems(user) && problem.createdById !== user.id) {
  return failure(c, 404, "problem-not-found", "题目不存在")
}
```

用的是**公开题**的规则（看 `problem.createdById`），而 `problem.ts:44-52` 的 `canEdit` 对比赛题走的是「看比赛创建者」。结果在比赛题上两套规则给出相反答案。

**旧后端对应行为**：`problem/views/admin.py:600-610` 的 `ProblemVisibleAPI.put` **完全没有归属校验**（而且 605-607 的 `self.error` 漏写 return，题不存在会 500）。新后端补了校验，是净收紧；这里记的是新后端内部两套规则不自洽。

**实跑验证**

题 41 位于 B 的比赛 5 里，但 `created_by_id = 2`（A，from-public 复制时继承的）：

```
PUT /api/admin/problems/41/visibility   (cookie = B，比赛所有者)  → 404 {"code":"problem-not-found","message":"题目不存在"}
PUT /api/admin/problems/41/visibility   (cookie = A，非比赛所有者) → 200 {"data":{"visible":false}}
GET /api/admin/problems/41              (cookie = A)              → 404   # canEdit 说 A 无权
GET /api/admin/problems/41              (cookie = B)              → 200   # canEdit 说 B 有权
```

同一道题，`canEdit` 判 B 能改、A 不能；`visibility` 判 A 能改、B 不能。A 能把 B 比赛里的题隐藏掉，B 自己反而改不回来。

**修法**：`visibility` 改用 `canEdit`。

### M2 — `from-public` 的错误码构成比赛存在性预言机

**文件**：`apps/api/src/routes/admin/problem.ts:544` vs `546-548`

比赛不存在返回 `not-found`，比赛存在但不属于你返回 `contest-not-found`。攻击者带一个已知有效的 `problemId`，就能靠错误码区分「这个 contestId 不存在」和「存在但是别人的」。其余所有跨租户路径都统一成了同一个码（已实跑确认：contest 系列全是 `contest-not-found`、problemset 系列全是 `problem-set-not-found`、problem 系列全是 `problem-not-found`），只有这一处破例。

**旧后端对应行为**：`problem/views/admin.py:493-494` 统一返回 `"Contest or Problem does not exist"`，不区分。

（仅静态判断 + 上文 I2 实跑观察到的错误码差异，未专门构造预言机实验。）

### M3 — 三个 admin 端点的守卫写在 handler 体内，不在注册行

**文件**：`apps/api/src/routes/submission.ts:221-224`、`submission.ts:337-340`、`apps/api/src/routes/flowchart.ts:142-145`

```ts
submissionRoutes.get("/submissions/statistics", requireAuth, async (c) => {
  if (!isTeacherOrAbove(c.get("user"))) return failure(c, 403, "permission-denied", ...)
submissionRoutes.post("/submissions/:id/rejudge", requireAuth, async (c) => {
  if (!isSuperAdmin(c.get("user"))) return failure(c, 403, "permission-denied", ...)
flowchartRoutes.get("/flowcharts/statistics", requireAuth, async (c) => {
  if (!isTeacherOrAbove(c.get("user"))) return failure(c, 403, "permission-denied", ...)
```

**档位本身正确**，与 `submission/views/admin.py:14`（`@super_admin_required`）、`submission/views/admin.py:31`（`@teacher_admin_required`）、`flowchart/views/admin.py:69`（`@teacher_admin_required`）逐条对应。问题只是写法违背了 `routes/admin/index.ts:15-21` 立下的约定（「守卫要从注册行上看得出来」），下一个人加同类端点时容易漏掉那个 if。建议改用 `requireTeacher` / `requireSuperAdmin` 中间件。

（仅静态判断，未实跑 —— 这三条不在阶段 4 的 admin 目录里。）

### M4 — 禁用账号落到 401 `login-required`，与旧后端的「账号已禁用」不同

**文件**：`apps/api/src/auth/middleware.ts:32-34`（注释）、`41`

`getSessionUser` 对禁用用户返回 null → 401 `login-required`。旧 `account/decorators.py:36-37` 是先过权限检查再报 `permission-denied` + 「账号已禁用」。

方向上更安全（提前一步拦），但前端拦截器对 `login-required` 是弹登录框：一个会话中途被禁用的用户会陷入「弹登录框 → 登录 → 又被弹」的循环，而不是看到「账号已禁用」。属于可用性 / 可诊断性问题，不是越权。

（仅静态判断。）

---

## 有意偏离的独立判断

| 偏离 | 判断 | 依据 |
|---|---|---|
| 删除不存在的记录返回 404 而非静默成功 | **合理** | 旧 `announcement/views/admin.py:57-61`、`tutorial/views/admin.py:62-66`、`achievement/views/admin.py:72-78` 都是 `filter().delete()` 静默成功，后台点了删除却没删掉是真的会误导人。这些资源全在 Super Admin 档位，404 不构成枚举风险。**唯一例外是奖章删除**——那里的 404 和真实副作用不一致，见 C1，问题不在 404 本身而在事务顺序。 |
| 题单后台列表不按 visible 过滤 | **合理，且是必要修复** | 旧 `problemset/views/admin.py:35` 写死 `filter(visible=True)`，同时 `ProblemSetVisibleAPI`(356-372) 又提供切换可见性——设成不可见后题单从后台列表消失，界面上再也改不回来。新写法仍保留 `createdById` 过滤（`problemset.ts:80`），越权面没有变化。已实跑确认 A 看不到 B 的题单（`GET /problem-sets` 返回 `{"results":[],"total":0}`）。 |
| ACM 核查校验 rank 归属 | **合理，且修掉了旧后端一个真洞** | 旧 `contest/views/admin.py:205` 只按 `pk=data["rank_id"]` 取，任一 Teacher Admin 带任意 rank_id 就能改别的比赛的核查标记。新 `contest.ts:298-302` 用 `and(id, contestId)` 收口，父子归属正确。（静态判断 + `GET /contests/3/acm-helper` 的跨租户 404 实跑，PUT 分支因需要真实 ACM 排名数据未实跑。） |
| 题目删除统一成一条路由 | **合理** | 旧的两条（`ProblemAPI.delete` 332 行 `contest_id__isnull=True` + `ContestProblemAPI.delete` 443 行 `contest_id__isnull=False`）只是按 contestId 分流，比赛是从题目推导出来的，前端根本不需要传 contestId。新 `problem.ts:371-379` 的 `canEdit` 已经把两种归属规则都覆盖了：公开题看题目创建者、比赛题看比赛创建者，与旧的 `ensure_created_by(problem)` / `ensure_created_by(problem.contest)` 一一对应。附带把「有提交记录不能删」从只对比赛题生效（旧 447 行）推广到公开题，是收紧不是放松。 |

---

## 核实过、确认没问题的部分

这一节界定覆盖面，与上面的问题清单同等重要。

**角色守卫档位（86/86 逐条比对，全部一致，无一漏挂）**

| 新后端路由组 | 守卫 | 旧后端装饰器 | 结论 |
|---|---|---|---|
| `/users*`（6 条） | requireSuperAdmin | `account/views/admin.py:43,76,125,159,244` `@super_admin_required` | 一致 |
| `/announcements*`（5 条） | requireSuperAdmin | `announcement/views/admin.py:13,23,40,57` | 一致 |
| `/tutorials*` `/exercises*`（10 条） | requireSuperAdmin | `tutorial/views/admin.py:17,27,44,62,70,90,106,119,127` | 一致 |
| `/achievements*` `/achievement-metrics`（6 条） | requireSuperAdmin | `achievement/views/admin.py:10,21,43,72,82` | 一致 |
| `/website` `/judge-servers*` `/orphan-test-cases*` `/dashboard` `/random-usernames`（9 条） | requireSuperAdmin | `conf/views.py:49,66,76,84,148,162`；`DashboardInfoAPI`(187) 与 `RandomUsernameAPI`(216) 旧后端**无装饰器** | 一致或**收紧**（后两条旧后端任何人可读，含班级用户名枚举） |
| `/contests*`（5 条） | requireTeacher | `contest/views/admin.py:33,53,78,267` `@teacher_admin_required` | 一致 |
| `/contests/:id/acm-helper`（2 条） | requireTeacher | `contest/views/admin.py:167,200` | 一致 |
| `/problem-sets*`（15 条） | requireTeacher | `problemset/views/admin.py` 全部 `@teacher_admin_required` | 一致 |
| `/ai/reports*`（3 条） | requireTeacher | `ai/views/admin.py:9,31` `@teacher_admin_required` | 一致 |
| `/problems/stuck` `/problems/ac-trend` | requireTeacher（写了但被遮蔽） | `problem/views/admin.py:639,676` | 档位对，见 I1 |
| `/problems*` `/contests/:id/problems*` `/test-cases` `/sql-test-cases/*`（14 条） | requireProblemPermission | `problem/views/admin.py:237,259,294,326,458,757,798`；`TestCaseAPI`(143)、`ContestProblemAPI`(343) 旧后端**无装饰器**、`AddContestProblemAPI`(486) 亦无 | 一致或**收紧** |
| `/problem-tags*` `/problems/batch-tag` `/problems/:id/visibility` `/problems/flowchart`（5 条） | requireProblemPermission | `problem/views/admin.py:515,524,554,570,601,614` | 一致 |

**中间件语义**（`auth/middleware.ts:48-67`）：`ADMIN_ROLES` / `TEACHER_ROLES` 白名单与 `account/models.py:65-73` 的 `is_admin_role()` / `is_teacher_or_above()` 逐项一致；`requireProblemPermission` = 管理员 ∧ `problemPermission !== "None"`，与 `decorators.py:78-84` 一致。已实跑确认 Teacher Admin + `problem_permission='None'` 在 `/problems/stuck` 上得到 403，在 `/contests` 上得到 200。

**跨租户读写隔离（实跑，全部 404、不泄露存在性）**

```
(cookie = B, 全部指向 A 的资源)
GET    /api/admin/problem-sets/2                  → 404 problem-set-not-found
GET    /api/admin/problem-sets/2/badges           → 404 problem-set-not-found
DELETE /api/admin/problem-sets/3/progress/4       → 404 problem-set-not-found   (A 打 B)
PUT    /api/admin/problem-sets/2/problems/1       → 404 problem-not-in-set      (跨题单 itemId)
GET    /api/admin/contests/3                      → 404 contest-not-found
PUT    /api/admin/contests/3                      → 404 contest-not-found
GET    /api/admin/contests/3/problems             → 404 contest-not-found
GET    /api/admin/contests/3/acm-helper           → 404 contest-not-found
GET    /api/admin/problems/37                     → 404 problem-not-found
DELETE /api/admin/problems/37                     → 404 problem-not-found
GET    /api/admin/problems/37/test-cases          → 404 problem-not-found
PUT    /api/admin/problems/37/visibility          → 404 problem-not-found
GET    /api/admin/problems                        → 200 {"results":[],"total":0}   # 列表按 createdById 过滤
POST   /api/admin/problems/batch-tag {problemIds:[40]}  → 404 no-problems          # 非本人题目被过滤掉
```

错误消息统一是「不存在」，没有出现「无权限」。**归属校验的正向行为是对的，问题只出在 C1/C2/I2 三条例外路径上。**

**超管旁路（实跑）**：`student` 提为 Super Admin 后，`GET /problem-sets/3`、`GET /contests/5`、`GET /problems/41` 全部 200，`ownedBy` / `canEdit` 的超管分支正确。

**其他确认无误的点**

- `canEdit`（`problem.ts:44-52`）对「比赛题看比赛创建者、公开题看题目创建者」的区分实现正确，且比赛题分支**不**给 `problemPermission=All` 旁路 —— 与旧 `ensure_created_by` 对非 Problem 实例只认 `created_by`/超管的语义一致
- `PUT /problem-sets/:id/problems/:itemId`、`DELETE /problem-sets/:id/problems/:itemId`、`PUT /problem-sets/:id/badges/:badgeId`、`DELETE /problem-sets/:id/progress/:userId` 的父子归属都写在同一条 `and()` 里，无 TOCTOU，已实跑确认（**只有 badges 的 DELETE 例外，见 C1**）
- `DELETE /problem-tags/:id`（`tag.ts:92-102`）的事务里先删 `problemTags` 再删 `problemTag`，但删的是同一个 id，标签不存在时前一句是空操作，**不存在 C1 那种连带破坏**
- `DELETE /users`（`account.ts:237-257`）禁止删除自己，已实跑确认返回 400 `cannot-delete-self`
- `PUT /users/:id` 的 `normalizePermission`（`account.ts:49-53`）与 `account/views/admin.py:98-105` 的归一逻辑一致，降级超管会同步清掉 All
- 真名下发受控：`sampleUser`（`routes/helpers.ts:15-25`）默认 `realName: null`，只有 `acm-helper`（`contest.ts:272`）和题单进度（`problemset.ts:426`）两处显式下发，两处都在 requireTeacher + 归属校验之后
- `GET /ai/reports/:id`（`ai.ts:70-83`）不下发 `data` / `systemPrompt` / `userPrompt`
- `GET /judge-servers`（`conf.ts:90-100`）下发 judge token，但在 requireSuperAdmin 之后，与旧 `conf/views.py:66-74` 一致
- `DELETE /orphan-test-cases`（`conf.ts:147-160`）对指定 id 也先确认是孤儿，比旧 `conf/views.py:162-171` 严 —— 合理收紧

---

## 覆盖率

| 项 | 数 |
|---|---|
| `routes/admin/*.ts` 中的 handler | 86 |
| 逐条静态比对旧后端装饰器的 handler | 86（100%） |
| `/admin` 之外但对应旧 admin 视图的 handler | 3（submission statistics / rejudge、flowchart statistics） |
| **合计评审端点** | **89** |
| 实跑验证的端点 | **46**（52%） |
| 实跑覆盖的角色组合 | Regular User(隐含匿名 401)、Student Admin+Own、Teacher Admin+None、Teacher Admin+Own、Super Admin+All |
| 实跑的跨租户攻击路径 | 18 条（14 条被正确拦截、4 条成功越权） |

未实跑的 43 条主要是：只在 Super Admin 档位、无归属概念的 CRUD（tutorials/exercises/achievements/announcements 的写操作），以及需要真实测试点文件或真实 ACM 排名数据的端点（`/test-cases` 上传、`/sql-scripts`、`/sql-test-cases/*`、`acm-helper` 的 PUT、`/problems/flowchart` 需要 AI 服务）。这些的守卫档位已逐条静态核对，均与旧后端一致。

## 环境还原确认

```
select 'problem',count(*) from problem     → 20      (与评审开始时一致)
select 'contest',count(*) from contest     → 0
select 'problemset',count(*) from problemset → 0
select 'badge',count(*) from problemset_badge → 0
select 'user_badge',count(*) from user_badge  → 0
select count(*) from problem_tag where id=95  → 0    (测试标签已删)

id|username|admin_type   |problem_permission
1 |devadmin|Super Admin  |All
2 |student |Regular User |None
4 |e2etest |Regular User |None
```

`e2etest` 的密码在测试中被 reset-password 接口改掉，已通过 `PUT /users/4` 改回 `Test123456` 并重新登录验证成功；`user_profile.real_name` 也已还原为 NULL。未执行任何 drop / truncate。
