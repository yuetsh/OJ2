# 端点清单（已裁决）

生成时间：2026-08-06　　裁决时间：2026-08-06
合计 127 个端点 —— KEEP 110、CUT 17、REVIEW 0

**裁决结果：新后端需实现 110 个端点，砍掉 17 个（占 13%）。**

裁决说明：机器初判的 6 条 REVIEW 全部判为 KEEP。其中 5 条是下述提取盲点造成的假阴性
（前端确实在调用，只是提取脚本抓不到）；`/api/judge_server_heartbeat/` 不经前端，是判题机
向后端注册心跳的接口，新架构判题沙箱镜像原样复用，必须保留。

> ⚠️ 本文件已完成人工裁决，**不要再运行 `docs/spikes/reconcile.ts`** —— 它会重新生成本文件，
> 把上面的裁决结果和末列理由全部冲掉。若确需重跑（例如后端 urls 有变动），先备份本文件。

> 已知盲点 1：`ojnext/src/oj/api.ts` 第 45、73 行用变量动态传路径（形如 `http.get(endpoint)`），提取脚本的正则匹配不到这类调用。因此对应的后端端点会被本表判成“前端无调用”，但实际可能仍在使用 —— 例如 `/api/contest_submissions`（`getSubmissions` 里 `endpoint` 变量的另一分支）。

> 已知盲点 2：`ojnext` 里有 4 处用原生 `fetch("/api/...")` 而非 `http.get/post(...)` 发起请求（AI 流式响应场景：`src/oj/store/ai.ts`、`src/oj/problem/components/SubmissionResult.vue`、`src/oj/rank/list.vue`、`src/oj/class/pk.vue`），提取脚本只认 `get/post/put/delete(...)` 调用形式，完全抓不到 `fetch(...)`。本轮 REVIEW 里的 `/api/ai/analysis`、`/api/ai/hint`、`/api/ai/class_pk`、`/api/ai/class_single` 经人工核实均属此类，实际都在用。

> 已知盲点 3：`ojnext/src/utils/download.ts` 是一个独立的 axios 实例（`baseURL: "/api/admin"`，与 `src/utils/http.ts` 那个共用实例无关），对外只暴露 `download(url)` 一个函数，内部走 `http.get(url)`。提取脚本既不认 `download(...)` 这种调用名，也抓不到内部那个变量 `url`，所以这条通道上的调用一律是假阴性。当前两个调用点（`src/admin/problem/components/Actions.vue:46`、`src/admin/problem/detail.vue:316`）都指向 `admin/test_case`，而该端点已因别处的字面量调用被判成 KEEP，**本轮结论不受影响**。但日后新增的 `download(...)` 调用会静默变成假阴性 CUT，裁决时留意。

> 盲点 1、2、3 都是“前端有调用=否”但实际有调用，人工裁决时不要仅凭本表这一列就判 CUT；REVIEW 里唯一不属于此类的是 `/api/judge_server_heartbeat/`——它是判题机而非前端调用的接口，不受提取脚本盲点影响，是否保留需按后端间调用来判断。

> 反向对账（前端调用了、后端却查无此端点）：**0 条**，前端全部调用路径都能在后端端点全集里找到对应。

| 裁决 | app | 侧 | 路径 | 视图 | 前端有调用 | 已标 DEPRECATED | 理由 |
|---|---|---|---|---|---|---|---|
| CUT | account | oj | `/api/change_password` | UserChangePasswordAPI.as_view | 否 | 是 | |
| CUT | account | oj | `/api/change_email` | UserChangeEmailAPI.as_view | 否 | 是 | |
| CUT | account | oj | `/api/check_username_or_email` | UsernameOrEmailCheck.as_view | 否 | 是 | |
| CUT | account | oj | `/api/sessions` | SessionManagementAPI.as_view | 否 | 是 | |
| CUT | account | oj | `/api/open_api_appkey` | OpenAPIAppkeyAPI.as_view | 否 | 是 | |
| CUT | account | oj | `/api/sso` | SSOAPI.as_view | 否 | 是 | |
| CUT | account | admin | `/api/admin/generate_user` | GenerateUserAPI.as_view | 否 | 是 | |
| CUT | conf | oj | `/api/languages` | LanguagesAPI.as_view | 否 | 是 | |
| CUT | contest | oj | `/api/contest/announcement` | ContestAnnouncementListAPI.as_view | 否 | 是 | |
| CUT | contest | admin | `/api/admin/contest/announcement` | ContestAnnouncementAPI.as_view | 否 | 是 | |
| CUT | contest | admin | `/api/admin/download_submissions` | DownloadContestSubmissions.as_view | 否 | 是 | |
| CUT | problemset | oj | `/api/problemset/<int:problem_set_id>/problems/<int:problem_id>` | ProblemSetProblemAPI.as_view | 否 | 是 | |
| CUT | problemset | oj | `/api/problemset/<int:problem_set_id>/progress` | ProblemSetProgressAPI.as_view | 否 | 是 | |
| CUT | problemset | oj | `/api/user/progress` | UserProgressAPI.as_view | 否 | 是 | |
| CUT | problemset | admin | `/api/admin/problemset/<int:problem_set_id>/sync` | ProblemSetSyncAPI.as_view | 否 | 是 | |
| CUT | submission | oj | `/api/submission_exists` | SubmissionExistsAPI.as_view | 否 | 是 | |
| CUT | utils | admin | `/api/admin/upload_file` | SimditorFileUploadAPIView.as_view | 否 | 是 | |
| KEEP | account | oj | `/api/login` | UserLoginAPI.as_view | 是 | 否 | |
| KEEP | account | oj | `/api/logout` | UserLogoutAPI.as_view | 是 | 否 | |
| KEEP | account | oj | `/api/register` | UserRegisterAPI.as_view | 是 | 否 | |
| KEEP | account | oj | `/api/profile` | UserProfileAPI.as_view | 是 | 否 | |
| KEEP | account | oj | `/api/profile/fresh_display_id` | ProfileProblemDisplayIDRefreshAPI.as_view | 是 | 否 | |
| KEEP | account | oj | `/api/metrics` | Metrics.as_view | 是 | 否 | |
| KEEP | account | oj | `/api/upload_avatar` | AvatarUploadAPI.as_view | 是 | 否 | |
| KEEP | account | oj | `/api/user_rank` | UserRankAPI.as_view | 是 | 否 | |
| KEEP | account | oj | `/api/user_activity_rank` | UserActivityRankAPI.as_view | 是 | 否 | |
| KEEP | account | oj | `/api/user_problem_rank` | UserProblemRankAPI.as_view | 是 | 否 | |
| KEEP | account | admin | `/api/admin/user` | UserAdminAPI.as_view | 是 | 否 | |
| KEEP | account | admin | `/api/admin/reset_password` | ResetUserPasswordAPI.as_view | 是 | 否 | |
| KEEP | achievement | oj | `/api/achievements` | AchievementListAPI.as_view | 是 | 否 | |
| KEEP | achievement | oj | `/api/achievements/summary` | AchievementSummaryAPI.as_view | 是 | 否 | |
| KEEP | achievement | oj | `/api/achievements/pending` | AchievementPendingAPI.as_view | 是 | 否 | |
| KEEP | achievement | admin | `/api/admin/achievement` | AchievementAdminAPI.as_view | 是 | 否 | |
| KEEP | achievement | admin | `/api/admin/achievement/metrics` | AchievementMetricAdminAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/detail` | AIDetailDataAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/duration` | AIDurationDataAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/heatmap` | AIHeatmapDataAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/login_summary` | AILoginSummaryAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/pinned` | AIPinnedReportAPI.as_view | 是 | 否 | |
| KEEP | ai | admin | `/api/admin/ai/reports` | AIAnalysisAdminAPI.as_view | 是 | 否 | |
| KEEP | announcement | oj | `/api/announcement` | AnnouncementAPI.as_view | 是 | 否 | |
| KEEP | announcement | admin | `/api/admin/announcement` | AnnouncementAdminAPI.as_view | 是 | 否 | |
| KEEP | class_pk | oj | `/api/class_rank` | ClassRankAPI.as_view | 是 | 否 | |
| KEEP | class_pk | oj | `/api/user_class_rank` | UserClassRankAPI.as_view | 是 | 否 | |
| KEEP | class_pk | oj | `/api/class_pk` | ClassPKAPI.as_view | 是 | 否 | |
| KEEP | conf | oj | `/api/website` | WebsiteConfigAPI.as_view | 是 | 否 | |
| KEEP | conf | oj | `/api/hitokoto` | HitokotoAPI.as_view | 是 | 否 | |
| KEEP | conf | oj | `/api/class_usernames` | ClassUsernamesAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/website` | WebsiteConfigAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/random_user` | RandomUsernameAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/judge_server` | JudgeServerAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/prune_test_case` | TestCasePruneAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/dashboard_info` | DashboardInfoAPI.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contests` | ContestListAPI.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contest` | ContestAPI.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contest/password` | ContestPasswordVerifyAPI.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contest/access` | ContestAccessAPI.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contest_rank` | ContestRankAPI.as_view | 是 | 否 | |
| KEEP | contest | admin | `/api/admin/contest` | ContestAPI.as_view | 是 | 否 | |
| KEEP | contest | admin | `/api/admin/contest/clone` | ContestCloneAPI.as_view | 是 | 否 | |
| KEEP | contest | admin | `/api/admin/contest/acm_helper` | ACMContestHelper.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submission` | FlowchartSubmissionAPI.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submissions` | FlowchartSubmissionListAPI.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submission/retry` | FlowchartSubmissionRetryAPI.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submission/detail` | FlowchartSubmissionDetailAPI.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submission/current` | FlowchartSubmissionCurrentAPI.as_view | 是 | 否 | |
| KEEP | flowchart | admin | `/api/admin/flowchart/statistics` | FlowchartStatisticsAPI.as_view | 是 | 否 | |
| KEEP | message | oj | `/api/message` | MessageAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem/tags` | ProblemTagAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem` | ProblemAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem/beat_count` | ProblemSolvedPeopleCount.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem/similar` | SimilarProblemAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem/author` | ProblemAuthorAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem/yearly_ac` | ProblemYearlyACRateAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/pickone` | PickOneAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/contest/problem` | ContestProblemAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/test_case` | TestCaseAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/sql_test_case_preview` | SQLTestCasePreviewAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/sql_test_case_scripts` | SQLTestCaseScriptsAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/sql_test_case_ai_gen` | SQLTestCaseAIGenAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/problem` | ProblemAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/problem/visible` | ProblemVisibleAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/problem/stuck` | StuckProblemsAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/problem/top_ac_trend` | TopACTrendAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/problem/flowchart` | ProblemFlowchartAIGen.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/problem/tag` | TagAdminAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/problem/batch_tag` | BatchProblemTagAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/contest/problem` | ContestProblemAPI.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/contest_problem/make_public` | MakeContestProblemPublicAPIView.as_view | 是 | 否 | |
| KEEP | problem | admin | `/api/admin/contest/add_problem_from_public` | AddContestProblemAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset` | ProblemSetAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/<int:problem_set_id>` | ProblemSetDetailAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/<int:problem_set_id>/problems` | ProblemSetProblemAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/progress` | ProblemSetProgressAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/user/badges` | UserBadgeAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/<int:problem_set_id>/badges` | ProblemSetBadgeAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/<int:problem_set_id>/users_progress` | ProblemSetUserProgressAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset` | ProblemSetAdminAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset/visible` | ProblemSetVisibleAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset/status` | ProblemSetStatusAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset/<int:problem_set_id>` | ProblemSetDetailAdminAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset/<int:problem_set_id>/problems` | ProblemSetProblemAdminAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset/<int:problem_set_id>/problems/<int:problem_set_problem_id>` | ProblemSetProblemAdminAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset/<int:problem_set_id>/badges` | ProblemSetBadgeAdminAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset/<int:problem_set_id>/badges/<int:badge_id>` | ProblemSetBadgeAdminAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset/<int:problem_set_id>/progress` | ProblemSetProgressAdminAPI.as_view | 是 | 否 | |
| KEEP | problemset | admin | `/api/admin/problemset/<int:problem_set_id>/progress/<int:user_id>` | ProblemSetProgressAdminAPI.as_view | 是 | 否 | |
| KEEP | reaction | oj | `/api/reaction` | ReactionAPI.as_view | 是 | 否 | |
| KEEP | submission | oj | `/api/submission` | SubmissionAPI.as_view | 是 | 否 | |
| KEEP | submission | oj | `/api/submissions` | SubmissionListAPI.as_view | 是 | 否 | |
| KEEP | submission | oj | `/api/submissions/today_count` | SubmissionsTodayCount.as_view | 是 | 否 | |
| KEEP | submission | oj | `/api/format_code` | FormatCodeAPI.as_view | 是 | 否 | |
| KEEP | submission | admin | `/api/admin/submission/rejudge` | SubmissionRejudgeAPI.as_view | 是 | 否 | |
| KEEP | submission | admin | `/api/admin/submission/statistics` | SubmissionStatisticsAPI.as_view | 是 | 否 | |
| KEEP | tutorial | oj | `/api/tutorial` | TutorialAPI.as_view | 是 | 否 | |
| KEEP | tutorial | oj | `/api/tutorials` | TutorialTitlesAPI.as_view | 是 | 否 | |
| KEEP | tutorial | oj | `/api/exercises` | ExerciseAPI.as_view | 是 | 否 | |
| KEEP | tutorial | admin | `/api/admin/tutorial` | TutorialAdminAPI.as_view | 是 | 否 | |
| KEEP | tutorial | admin | `/api/admin/tutorial/visibility` | TutorialVisibilityAPI.as_view | 是 | 否 | |
| KEEP | tutorial | admin | `/api/admin/exercise` | ExerciseAdminAPI.as_view | 是 | 否 | |
| KEEP | utils | admin | `/api/admin/upload_image` | SimditorImageUploadAPIView.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/analysis` | AIAnalysisAPI.as_view | 否 | 否 | 盲点 2：走原生 `fetch`（`src/oj/store/ai.ts:107`），实际在用 |
| KEEP | ai | oj | `/api/ai/hint` | AIHintAPI.as_view | 否 | 否 | 盲点 2：走原生 `fetch`（`src/oj/problem/components/SubmissionResult.vue:86`），实际在用 |
| KEEP | ai | oj | `/api/ai/class_pk` | ClassPKAnalysisAPI.as_view | 否 | 否 | 盲点 2：走原生 `fetch`（`src/oj/class/pk.vue:179`），实际在用 |
| KEEP | ai | oj | `/api/ai/class_single` | SingleClassAnalysisAPI.as_view | 否 | 否 | 盲点 2：走原生 `fetch`（`src/oj/rank/list.vue:98`），实际在用 |
| KEEP | conf | oj | `/api/judge_server_heartbeat/` | JudgeServerHeartbeatAPI.as_view | 否 | 否 | 非前端调用：判题机向后端注册心跳。新架构判题沙箱镜像原样复用，此接口必须保留 |
| KEEP | submission | oj | `/api/contest_submissions` | ContestSubmissionListAPI.as_view | 否 | 否 | 盲点 1：`getSubmissions` 里 `endpoint` 变量的比赛分支（`src/oj/api.ts:73`），实际在用 |

---

## 交付核对（2026-08-08，阶段 5 之后）

把这张表里的 **110 条 KEEP 逐条对到新后端**，确认没有「当初判了要搬、后来忘了」的。

**结果：110/110 全部有对应实现，零缺口。**

核对方法：把旧路径和新后端注册的 167 条路由都做词元化（去掉 `/api`、`admin`、
参数段，snake/kebab 拆开，单复数归一）后求交集。87 条自动匹配上，剩下 23 条
（API 是重新设计过的，路径本来就对不上）逐条人工落实，见下表。

> 方法的局限：词元匹配只能提示「这两条像是同一个」，不能证明**行为**一致。
> 行为一致性靠的是阶段 3/4 的两轮独立评审和阶段 5 的实跑演练，不是这张表。

### 非显然的改名对照

`problemset` → `problem-sets` 这类一眼能猜到的没列。下面这些是**猜不到、
日后排查时会卡住人**的：

| 旧（Django） | 新（Bun） |
|---|---|
| `POST /api/register` | `POST /api/users` |
| `GET /api/logout` | `DELETE /api/auth/session` |
| `GET /api/hitokoto` | `GET /api/quotes/random` |
| `GET /api/pickone` | `GET /api/problems/random` |
| `GET /api/user_activity_rank` | `GET /api/rankings/activity` |
| `GET /api/profile/fresh_display_id` | `POST /api/me/problem-display-ids/refresh` |
| `GET /api/flowchart/submission/detail` | `GET /api/flowcharts/:id` |
| `POST /api/reaction` | `POST /api/problems/:id/reaction` |
| `PUT /api/admin/problemset/visible` | `PUT /api/admin/problem-sets/:id/visibility` |
| `GET /api/judge_server_heartbeat/` | `POST /api/judge-server/heartbeat` |

最后一条尤其要注意：**判题沙箱镜像是原样复用的**，它靠 compose 里的
`BACKEND_URL` 找后端，三套 compose 都已改成新路径。改动这条要同步改 compose，
否则判题机会静默离线。
