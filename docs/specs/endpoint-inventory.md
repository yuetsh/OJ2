# 端点清单（机器初判）

生成时间：2026-08-07
合计 122 个端点 —— KEEP 100、CUT 16、REVIEW 6

> REVIEW 项需人工裁决，裁决后把本行的 REVIEW 改成 KEEP 或 CUT，并在末列写明理由。

> 已知盲点 1：`ojnext/src/oj/api.ts` 第 45、73 行用变量动态传路径（形如 `http.get(endpoint)`），提取脚本的正则匹配不到这类调用。因此对应的后端端点会被本表判成“前端无调用”，但实际可能仍在使用 —— 例如 `/api/contest_submissions`（`getSubmissions` 里 `endpoint` 变量的另一分支）。

> 已知盲点 2：`ojnext` 里有 4 处用原生 `fetch("/api/...")` 而非 `http.get/post(...)` 发起请求（AI 流式响应场景：`src/oj/store/ai.ts`、`src/oj/problem/components/SubmissionResult.vue`、`src/oj/rank/list.vue`、`src/oj/class/pk.vue`），提取脚本只认 `get/post/put/delete(...)` 调用形式，完全抓不到 `fetch(...)`。本轮 REVIEW 里的 `/api/ai/analysis`、`/api/ai/hint`、`/api/ai/class_pk`、`/api/ai/class_single` 经人工核实均属此类，实际都在用。

> 上述两类盲点都是“前端有调用=否”但实际有调用，人工裁决时不要仅凭本表这一列就判 CUT；REVIEW 里唯一不属于此类的是 `/api/judge_server_heartbeat/`——它是判题机而非前端调用的接口，不受提取脚本盲点影响，是否保留需按后端间调用来判断。

| 裁决 | app | 侧 | 路径 | 视图 | 前端有调用 | 已标 DEPRECATED | 理由 |
|---|---|---|---|---|---|---|---|
| CUT | account | admin | `/api/admin/generate_user` | GenerateUserAPI.as_view | 否 | 是 | |
| CUT | account | oj | `/api/change_password` | UserChangePasswordAPI.as_view | 否 | 是 | |
| CUT | account | oj | `/api/change_email` | UserChangeEmailAPI.as_view | 否 | 是 | |
| CUT | account | oj | `/api/check_username_or_email` | UsernameOrEmailCheck.as_view | 否 | 是 | |
| CUT | account | oj | `/api/sessions` | SessionManagementAPI.as_view | 否 | 是 | |
| CUT | account | oj | `/api/open_api_appkey` | OpenAPIAppkeyAPI.as_view | 否 | 是 | |
| CUT | account | oj | `/api/sso` | SSOAPI.as_view | 否 | 是 | |
| CUT | conf | oj | `/api/languages` | LanguagesAPI.as_view | 否 | 是 | |
| CUT | contest | admin | `/api/admin/contest/announcement` | ContestAnnouncementAPI.as_view | 否 | 是 | |
| CUT | contest | admin | `/api/admin/download_submissions` | DownloadContestSubmissions.as_view | 否 | 是 | |
| CUT | contest | oj | `/api/contest/announcement` | ContestAnnouncementListAPI.as_view | 否 | 是 | |
| CUT | problemset | admin | `/api/admin/problemset/<int:problem_set_id>/sync` | ProblemSetSyncAPI.as_view | 否 | 是 | |
| CUT | problemset | oj | `/api/problemset/<int:problem_set_id>/problems/<int:problem_id>` | ProblemSetProblemAPI.as_view | 否 | 是 | |
| CUT | problemset | oj | `/api/problemset/<int:problem_set_id>/progress` | ProblemSetProgressAPI.as_view | 否 | 是 | |
| CUT | problemset | oj | `/api/user/progress` | UserProgressAPI.as_view | 否 | 是 | |
| CUT | submission | oj | `/api/submission_exists` | SubmissionExistsAPI.as_view | 否 | 是 | |
| KEEP | account | admin | `/api/admin/user` | UserAdminAPI.as_view | 是 | 否 | |
| KEEP | account | admin | `/api/admin/reset_password` | ResetUserPasswordAPI.as_view | 是 | 否 | |
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
| KEEP | achievement | admin | `/api/admin/achievement` | AchievementAdminAPI.as_view | 是 | 否 | |
| KEEP | achievement | admin | `/api/admin/achievement/metrics` | AchievementMetricAdminAPI.as_view | 是 | 否 | |
| KEEP | achievement | oj | `/api/achievements` | AchievementListAPI.as_view | 是 | 否 | |
| KEEP | achievement | oj | `/api/achievements/summary` | AchievementSummaryAPI.as_view | 是 | 否 | |
| KEEP | achievement | oj | `/api/achievements/pending` | AchievementPendingAPI.as_view | 是 | 否 | |
| KEEP | ai | admin | `/api/admin/ai/reports` | AIAnalysisAdminAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/detail` | AIDetailDataAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/duration` | AIDurationDataAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/heatmap` | AIHeatmapDataAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/login_summary` | AILoginSummaryAPI.as_view | 是 | 否 | |
| KEEP | ai | oj | `/api/ai/pinned` | AIPinnedReportAPI.as_view | 是 | 否 | |
| KEEP | announcement | admin | `/api/admin/announcement` | AnnouncementAdminAPI.as_view | 是 | 否 | |
| KEEP | announcement | oj | `/api/announcement` | AnnouncementAPI.as_view | 是 | 否 | |
| KEEP | class_pk | oj | `/api/class_rank` | ClassRankAPI.as_view | 是 | 否 | |
| KEEP | class_pk | oj | `/api/user_class_rank` | UserClassRankAPI.as_view | 是 | 否 | |
| KEEP | class_pk | oj | `/api/class_pk` | ClassPKAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/website` | WebsiteConfigAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/random_user` | RandomUsernameAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/judge_server` | JudgeServerAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/prune_test_case` | TestCasePruneAPI.as_view | 是 | 否 | |
| KEEP | conf | admin | `/api/admin/dashboard_info` | DashboardInfoAPI.as_view | 是 | 否 | |
| KEEP | conf | oj | `/api/website` | WebsiteConfigAPI.as_view | 是 | 否 | |
| KEEP | conf | oj | `/api/hitokoto` | HitokotoAPI.as_view | 是 | 否 | |
| KEEP | conf | oj | `/api/class_usernames` | ClassUsernamesAPI.as_view | 是 | 否 | |
| KEEP | contest | admin | `/api/admin/contest` | ContestAPI.as_view | 是 | 否 | |
| KEEP | contest | admin | `/api/admin/contest/clone` | ContestCloneAPI.as_view | 是 | 否 | |
| KEEP | contest | admin | `/api/admin/contest/acm_helper` | ACMContestHelper.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contests` | ContestListAPI.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contest` | ContestAPI.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contest/password` | ContestPasswordVerifyAPI.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contest/access` | ContestAccessAPI.as_view | 是 | 否 | |
| KEEP | contest | oj | `/api/contest_rank` | ContestRankAPI.as_view | 是 | 否 | |
| KEEP | flowchart | admin | `/api/admin/flowchart/statistics` | FlowchartStatisticsAPI.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submission` | FlowchartSubmissionAPI.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submissions` | FlowchartSubmissionListAPI.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submission/retry` | FlowchartSubmissionRetryAPI.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submission/detail` | FlowchartSubmissionDetailAPI.as_view | 是 | 否 | |
| KEEP | flowchart | oj | `/api/flowchart/submission/current` | FlowchartSubmissionCurrentAPI.as_view | 是 | 否 | |
| KEEP | message | oj | `/api/message` | MessageAPI.as_view | 是 | 否 | |
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
| KEEP | problem | oj | `/api/problem/tags` | ProblemTagAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem` | ProblemAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem/beat_count` | ProblemSolvedPeopleCount.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem/similar` | SimilarProblemAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem/author` | ProblemAuthorAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/problem/yearly_ac` | ProblemYearlyACRateAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/pickone` | PickOneAPI.as_view | 是 | 否 | |
| KEEP | problem | oj | `/api/contest/problem` | ContestProblemAPI.as_view | 是 | 否 | |
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
| KEEP | problemset | oj | `/api/problemset` | ProblemSetAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/<int:problem_set_id>` | ProblemSetDetailAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/<int:problem_set_id>/problems` | ProblemSetProblemAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/progress` | ProblemSetProgressAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/user/badges` | UserBadgeAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/<int:problem_set_id>/badges` | ProblemSetBadgeAPI.as_view | 是 | 否 | |
| KEEP | problemset | oj | `/api/problemset/<int:problem_set_id>/users_progress` | ProblemSetUserProgressAPI.as_view | 是 | 否 | |
| KEEP | reaction | oj | `/api/reaction` | ReactionAPI.as_view | 是 | 否 | |
| KEEP | submission | admin | `/api/admin/submission/rejudge` | SubmissionRejudgeAPI.as_view | 是 | 否 | |
| KEEP | submission | admin | `/api/admin/submission/statistics` | SubmissionStatisticsAPI.as_view | 是 | 否 | |
| KEEP | submission | oj | `/api/submission` | SubmissionAPI.as_view | 是 | 否 | |
| KEEP | submission | oj | `/api/submissions` | SubmissionListAPI.as_view | 是 | 否 | |
| KEEP | submission | oj | `/api/submissions/today_count` | SubmissionsTodayCount.as_view | 是 | 否 | |
| KEEP | submission | oj | `/api/format_code` | FormatCodeAPI.as_view | 是 | 否 | |
| KEEP | tutorial | admin | `/api/admin/tutorial` | TutorialAdminAPI.as_view | 是 | 否 | |
| KEEP | tutorial | admin | `/api/admin/tutorial/visibility` | TutorialVisibilityAPI.as_view | 是 | 否 | |
| KEEP | tutorial | admin | `/api/admin/exercise` | ExerciseAdminAPI.as_view | 是 | 否 | |
| REVIEW | ai | oj | `/api/ai/analysis` | AIAnalysisAPI.as_view | 否 | 否 | |
| REVIEW | ai | oj | `/api/ai/hint` | AIHintAPI.as_view | 否 | 否 | |
| REVIEW | ai | oj | `/api/ai/class_pk` | ClassPKAnalysisAPI.as_view | 否 | 否 | |
| REVIEW | ai | oj | `/api/ai/class_single` | SingleClassAnalysisAPI.as_view | 否 | 否 | |
| REVIEW | conf | oj | `/api/judge_server_heartbeat/` | JudgeServerHeartbeatAPI.as_view | 否 | 否 | |
| REVIEW | submission | oj | `/api/contest_submissions` | ContestSubmissionListAPI.as_view | 否 | 否 | |
