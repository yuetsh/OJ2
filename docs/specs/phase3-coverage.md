# 阶段 3 覆盖率对账

日期：2026-08-07
基准：`docs/specs/endpoint-inventory.md` 的 110 条 KEEP 端点
对象：`apps/api/src/routes/*.ts` 的 79 个路由 handler（含未提交工作树）

## 结论

| | 旧端点 KEEP | 新后端已实现 | 缺口 |
|---|---|---|---|
| **oj 侧** | 65 | 65（另有 4 条新增） | **0** |
| **admin 侧** | 45 | **0** | **45** |
| 合计 | 110 | 65 | 45 |

**oj 侧已全部覆盖，admin 侧一条未做。** 这与设计文档第 11 节的阶段划分一致 —— admin 本就排在阶段 4。

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
| `PUT submissions/:id` | 判题结果写回 |
| `POST achievements/pending/read` | 成就已读标记 |
| `GET problems/:id/flowchart/history` | 流程图历史 |
| `GET dev/problems` | **阶段 1 的临时验证端点，应删除** |

## admin 侧缺口（45 条，按 app）

| app | 条数 |
|---|---|
| problem | 14 |
| problemset | 10 |
| conf | 5 |
| contest | 3 |
| tutorial | 3 |
| account | 2 |
| achievement | 2 |
| submission | 2 |
| ai | 1 |
| announcement | 1 |
| flowchart | 1 |
| utils | 1 |

`problem` 与 `problemset` 两块占了 24 条，超过 admin 缺口的一半 —— 排期时应作为主体。

## 待处理项

1. **`GET dev/problems` 是阶段 1 的临时验证端点**，与 `apps/web` 里的临时验证页 `dev-problems.vue` 配套，两者都应在本阶段收尾时删除。
2. 本报告的对照关系带人工判断成分，若某条对应有异议，以实际业务行为为准。
