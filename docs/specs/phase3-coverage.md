# 阶段 3 覆盖率对账

日期：2026-08-07（首次对账）／2026-08-07 补记（阶段 3 收口）
基准：`docs/specs/endpoint-inventory.md` 的 110 条 KEEP 端点
对象：`apps/api/src/routes/*.ts` 的路由 handler

> ## 状态：阶段 3 出口标准已达成
>
> 出口标准（设计文档第 11 节）是「用户侧全部功能运行在新后端上」。达成判据：
> `apps/web` 里 `oj/` 与 `shared/` 两个目录**已无任何指向旧 Django 的运行时调用**，
> 残留的 `utils/http` 引用全是 `import type { ApiResponse }` 这一个类型。
> 仍走旧后端的只剩 `admin/api.ts`（85 处）与 `utils/download.ts`，入口都在后台管理界面，属阶段 4。
>
> 收口时补做的三件事：
> 1. 补齐 3 条被用户侧页面调用的 admin 端点（重判 / 提交统计 / 流程图统计），见下表；
> 2. 删除阶段 1 的临时验证物（`GET dev/problems`、`dev-problems.vue`、路由项、`problemSummarySchema`）；
> 3. 给 `utils/api2.ts` 补上 `login-required` 弹登录框、`permission-denied` 弹提示 ——
>    这两条 `utils/http.ts` 一直有，api2 从建包起就漏了，导致此前已迁移的所有端点
>    在鉴权失败时都是「点了没反应」。新加的两个教师专属端点会放大这个问题，故一并补。
>
> 补记：两份评审里的 7 条 Minor 也已全部处理，逐条结论见 `phase3-fix-list.md` 文末。

## 结论

| | 旧端点 KEEP | 新后端已实现 | 缺口 |
|---|---|---|---|
| **oj 侧** | 65 | 65（另有 4 条新增） | **0** |
| **admin 侧** | 45 | **3** | **42** |
| 合计 | 110 | 68 | 42 |

**oj 侧已全部覆盖。** admin 侧原计划整块推到阶段 4，但其中 3 条被用户侧页面直接调用，
不做完阶段 3 的出口标准（用户侧全部功能跑在新后端上）就不成立，因此在本阶段一并补上：

| 旧端点 | 新路由 | 调用它的用户侧页面 |
|---|---|---|
| `GET admin/submission/rejudge` | `POST submissions/:id/rejudge` | `oj/submission/list.vue` 的重判按钮 |
| `GET admin/submission/statistics` | `GET submissions/statistics` | `StatisticsPanel.vue`（提交列表页 + 题目页） |
| `GET admin/flowchart/statistics` | `GET flowcharts/statistics` | `FlowchartStatisticsPanel.vue`（提交列表页） |

这三条虽然挂在旧后端的 admin 路由下，权限也确实是 `teacher_admin_required` /
`super_admin_required`，但入口在用户侧页面里 —— **「admin 路由」和「admin 页面」不是一回事**，
按 URL 前缀切阶段会漏掉它们。剩下 42 条的入口都在后台管理界面，留给阶段 4。

> 对账方法说明：阶段 0 已定案 API 重新设计，新旧路径不同名（如旧 `/api/problem` → 新 `/api/problems`、
> 旧 `/api/pickone` → 新 `/api/problems/random`），**无法按字符串自动匹配**。本表由人工按语义逐条比对，
> 判断依据是路由文件归属 + 路径语义 + HTTP 动词。个别条目的对应关系带主观判断，下表逐条列出以便复核。

## oj 侧逐条对照（65 条）

| 旧 app | 旧端点 | 新路由 |
|---|---|---|
| account | `login` | `POST auth/login` |
| account | `logout` | `DELETE auth/session` |
| account | `register` | `POST users` |
| account | `profile` | `GET me` / `GET profiles/:username` / `PUT me/profile` |
| account | `profile/fresh_display_id` | `POST me/problem-display-ids/refresh` |
| account | `metrics` | `GET users/:id/metrics` |
| account | `upload_avatar` | `POST me/avatar` |
| account | `user_rank` | `GET rankings/users` |
| account | `user_activity_rank` | `GET rankings/activity` |
| account | `user_problem_rank` | `GET problems/:displayId/rank` |
| achievement | `achievements` | `GET achievements` |
| achievement | `achievements/summary` | `GET achievements/summary` |
| achievement | `achievements/pending` | `GET achievements/pending` |
| ai | `ai/detail` | `GET ai/detail` |
| ai | `ai/duration` | `GET ai/duration` |
| ai | `ai/heatmap` | `GET ai/heatmap` |
| ai | `ai/login_summary` | `GET ai/login-summary` |
| ai | `ai/pinned` | `GET ai/pinned` |
| ai | `ai/analysis` | `POST ai/analysis` |
| ai | `ai/hint` | `POST ai/hint` |
| ai | `ai/class_pk` | `POST ai/class-pk-analysis` |
| ai | `ai/class_single` | `POST ai/class-analysis` |
| announcement | `announcement` | `GET announcements` / `GET announcements/:id` |
| class_pk | `class_rank` | `GET rankings/classes` |
| class_pk | `user_class_rank` | `GET me/class-rank` |
| class_pk | `class_pk` | `POST classes/comparison` |
| conf | `website` | `GET site` |
| conf | `hitokoto` | `GET quotes/random` |
| conf | `class_usernames` | `GET classes/:className/usernames` |
| conf | `judge_server_heartbeat/` | `POST judge-server/heartbeat` |
| contest | `contests` | `GET contests` |
| contest | `contest` | `GET contests/:id` |
| contest | `contest/password` | `POST contests/:id/access` |
| contest | `contest/access` | `GET contests/:id/access` |
| contest | `contest_rank` | `GET contests/:id/rank` |
| flowchart | `flowchart/submission`（POST） | `POST flowcharts` |
| flowchart | `flowchart/submissions` | `GET flowcharts` |
| flowchart | `flowchart/submission/retry` | `POST flowcharts/:id/retry` |
| flowchart | `flowchart/submission/detail` | `GET flowcharts/:id` |
| flowchart | `flowchart/submission/current` | `GET problems/:id/flowchart/current` |
| message | `message` | `GET messages` / `POST messages` |
| problem | `problem/tags` | `GET problem-tags` |
| problem | `problem` | `GET problems/:displayId` |
| problem | `problem/beat_count` | `GET problems/:id/beat-count` |
| problem | `problem/similar` | `GET problems/:displayId/similar` |
| problem | `problem/author` | `GET problem-authors` |
| problem | `problem/yearly_ac` | `GET problems/:displayId/yearly-ac` |
| problem | `pickone` | `GET problems/random` |
| problem | `contest/problem` | `GET contests/:id/problems` + `GET contests/:id/problems/:displayId` |
| problemset | `problemset` | `GET problem-sets` |
| problemset | `problemset/<id>` | `GET problem-sets/:id` |
| problemset | `problemset/<id>/problems` | `GET problem-sets/:id/problems` |
| problemset | `problemset/progress` | `POST problem-set-progress` / `PUT problem-set-progress` |
| problemset | `user/badges` | `GET users/:username/badges` |
| problemset | `problemset/<id>/badges` | `GET problem-sets/:id/badges` |
| problemset | `problemset/<id>/users_progress` | `GET problem-sets/:id/user-progress` |
| reaction | `reaction` | `GET problems/:id/reaction` / `POST problems/:id/reaction` |
| submission | `submission` | `GET submissions/:id` |
| submission | `submissions` | `GET submissions` |
| submission | `submissions/today_count` | `GET submissions/today-count` |
| submission | `format_code` | `POST code/format` |
| submission | `contest_submissions` | `GET contests/:contestId/submissions` |
| tutorial | `tutorial` | `GET tutorials/:id` |
| tutorial | `tutorials` | `GET tutorials` |
| tutorial | `exercises` | `GET tutorials/:id/exercises` |

### 新增的 4 条（旧后端没有对应）

| 新路由 | 说明 |
|---|---|
| `POST submissions` | 旧后端提交走 `POST /api/submission`，与 `GET submission` 同路径不同动词，拆开后成独立条目 |
| `PUT submissions/:id` | **提交分享开关**（对齐旧 `SubmissionAPI.put` + `ShareSubmissionSerializer`）。判题结果写回走内部 worker，不经 HTTP —— 早先这里写成「判题结果写回」，会让人误以为存在一个需要判题机凭据的写入端点 |
| `POST achievements/pending/read` | 成就已读标记 |
| `GET problems/:id/flowchart/history` | 流程图历史 |
| ~~`GET dev/problems`~~ | 阶段 1 的临时验证端点，**已删除**（连同 `dev-problems.vue`、路由与 `problemSummarySchema`） |

## admin 侧缺口（42 条，按 app）

| app | 条数 |
|---|---|
| problem | 14 |
| problemset | 10 |
| conf | 5 |
| contest | 3 |
| tutorial | 3 |
| account | 2 |
| achievement | 2 |
| ai | 1 |
| announcement | 1 |
| utils | 1 |

`problem` 与 `problemset` 两块占了 24 条，超过 admin 缺口的一半 —— 排期时应作为主体。
（`submission` 原 2 条、`flowchart` 原 1 条已在本阶段做完，见上方表格。）

## 待处理项

1. 本报告的对照关系带人工判断成分，若某条对应有异议，以实际业务行为为准。
2. `utils/download.ts` 仍指向旧后端的 `/api/admin`（blob 下载），只被 admin 侧两个页面用，随阶段 4 一起切。

---

## 阶段 5 切换必做项（阶段 4 施工时发现，记在这里以免忘）

**导入数据后必须重置全部序列。** 本地库是按显式 id 从生产导入的，
`problem_tag_id_seq` 停在 6 而表里 max(id)=87，于是第一次新建标签就撞
`duplicate key value violates unique constraint "problem_tag_pkey"`（500）。

生产切换若沿用同一个库则不受影响（序列本来就是对的）；但只要有任何一步是
「导出 → 导入到新库」，就必须补这一句：

```sql
do $$
declare r record; mx bigint;
begin
  for r in
    select split_part(pg_get_serial_sequence(quote_ident(t.table_name), c.column_name), '.', 2) as seqname,
           t.table_name, c.column_name
    from information_schema.tables t
    join information_schema.columns c on c.table_name = t.table_name
    join pg_sequences s on s.sequencename = split_part(pg_get_serial_sequence(quote_ident(t.table_name), c.column_name), '.', 2)
    where t.table_schema = 'public'
  loop
    execute format('select coalesce(max(%I),0) from %I', r.column_name, r.table_name) into mx;
    execute format('select setval(%L, greatest(%s, 1))', r.seqname, mx);
  end loop;
end $$;
```

症状很隐蔽：读全部正常，只有**写**才炸，而且是导入后第一次写才炸。
