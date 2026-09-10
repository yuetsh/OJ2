// 本文件由 `drizzle-kit pull` 从生产库自动生成，之后按下面几条手工维护。
//
// 2026-08-26：旧 Django 后端下线，7 张框架表（auth_group、auth_group_permissions、
// auth_permission、django_content_type、django_dramatiq_task、django_migrations、
// django_session）已由 0002_drop_django_leftovers 删除，drizzle.config.ts 的
// tablesFilter 随之移除。库里现在就是这 27 张业务表。
//
// 2026-09-02：又清了一批只有 Django 时代写过、OJ2 一次都没读过的列 ——
// 0008 删比赛 IP 白名单与 submission.ip（判题机的 judge_server.ip 保留，那是运维数据），
// 0009 删 user 的 auth_token / open_api / open_api_appkey / session_keys 和
// user_profile 的 blog / github / school / major / language。**删的判据是「全仓零读取」**，
// 不是「看着没用」：raw_password 同样刺眼却是在用的（老师要能查学生密码），别一起清掉。
//
// 手工修正（都是 `pull` 自己没法无损 round-trip 的地方，改回去会让 generate 产生假 diff，
// 详见 CLAUDE.md「改 schema 走 drizzle migration」）：
//   * bigint identity 的 maxValue 用字符串，不能写成 JS number 字面量（会丢精度）。
//   * 索引不写 `.desc()`，生成 SQL 时方向会被丢掉。
//   * `.$type<...>()` 的收窄（见下）—— `pull` 只会吐出 text/integer/jsonb，重新 pull
//     会把这些断言全抹掉，之后出参的 `satisfies` 会当场编译不过（这是好事，别拿
//     `as` 糊过去，把断言补回来）。
//
// 2026-09-10：出参不再 `xxxSchema.parse()` 而是 `satisfies`（原来 136 处），
// 收窄的责任因此挪到了列上：枚举型的列和几个形状确定的 JSONB 都挂了 `.$type<>()`。
// `$type` 只是 TS 层的断言、不产生任何 SQL，所以它成立与否得靠数据说话 ——
// 下面每一处都拿根目录那份生产备份逐列核过（12.4 万条提交的 result 全在 -2..6,10、
// 961 道题的 languages 全是合法数组、10050 条榜单条目形状全对，无一例外）。
// **再给别的列加 $type 之前，照样先核一遍全量数据。** 兑现这些断言的是写入侧的
// `safeParse`，不是读出侧。前因后果见 CLAUDE.md「出参不 `parse`，用 `satisfies`」。
//
// 关于 10 张表的 bigint id（problemset*、achievement、user_achievement、user_stat、
// user_badge、ai_analysis）：这是历史巧合不是设计——这些 app 的 0001_initial 生成时
// Django 还没设 DEFAULT_AUTO_FIELD，用了 3.2+ 的默认 BigAutoField；更早的表（user、
// problem、contest、submission）都是 int4。现存最大 id 一万出头，确实都用不上 bigint，
// 但 2026-08-26 评估后决定**不改**：省 4 字节/行毫无意义，ALTER TYPE 要重写整表并拿
// ACCESS EXCLUSIVE 锁，而且其中 6 处 id 被外键绑着得连坐。别再提这件事了。
import type {
	AchievementOperator,
	AchievementRarity,
	AdminType,
	AstRules,
	BadgeConditionType,
	ContestSubmissionInfo,
	ExerciseType,
	FlowchartStatus,
	JudgeStatus,
	ProblemDifficulty,
	ProblemLanguage,
	ProblemPermission,
	ProblemSetDifficulty,
	ProblemSetStatus,
	ReactionKey,
	SqlConfig,
	SqlDisplay,
	TutorialType,
} from "@oj2/contract"
import { pgTable, index, foreignKey, primaryKey, bigint, text, jsonb, timestamp, integer, boolean, serial, doublePrecision, varchar, unique, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const aiAnalysis = pgTable("ai_analysis", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "ai_analysis_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	provider: text().notNull(),
	data: jsonb().notNull(),
	systemPrompt: text("system_prompt").notNull(),
	userPrompt: text("user_prompt").notNull(),
	analysis: text().notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	userId: integer("user_id").notNull(),
	model: text().notNull(),
	isPinned: boolean("is_pinned").notNull(),
}, (table) => [
	index("ai_analysis_user_id_3aa23011").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "ai_analysis_user_id_3aa23011_fk_user_id"
		}),
]);

export const announcement = pgTable("announcement", {
	id: serial().primaryKey().notNull(),
	title: text().notNull(),
	content: text().notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	lastUpdateTime: timestamp("last_update_time", { withTimezone: true, mode: 'string' }).notNull(),
	visible: boolean().notNull(),
	createdById: integer("created_by_id").notNull(),
	tag: text().notNull(),
	top: boolean().notNull(),
}, (table) => [
	index("announcement_created_by_id_359ccf50").using("btree", table.createdById.asc().nullsLast().op("int4_ops")),
	// 不写 .op()：opclass 会吞掉方向（见 CLAUDE.md）。生产库是 (visible, top DESC, create_time DESC)，
	// 写了 .op() 的话 generate 出来的是全 ASC，schema.ts 就和真实库对不上了。
	index("announcement_list_idx").using("btree", table.visible.asc().nullsLast(), table.top.desc().nullsFirst(), table.createTime.desc().nullsFirst()),
	foreignKey({
			columns: [table.createdById],
			foreignColumns: [user.id],
			name: "announcement_created_by_id_359ccf50_fk_user_id"
		}),
]);

export const achievement = pgTable("achievement", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "achievement_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	name: text().notNull(),
	description: text().notNull(),
	icon: text().notNull(),
	rarity: text().notNull().$type<AchievementRarity>(),
	hidden: boolean().default(false).notNull(),
	metric: text().notNull(),
	operator: text().notNull().$type<AchievementOperator>(),
	threshold: integer().notNull(),
	visible: boolean().default(true).notNull(),
	unlockCount: integer("unlock_count").default(0).notNull(),
	order: integer().default(0).notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
});

export const contest = pgTable("contest", {
	id: serial().primaryKey().notNull(),
	title: text().notNull(),
	description: text().notNull(),
	password: text(),
	startTime: timestamp("start_time", { withTimezone: true, mode: 'string' }).notNull(),
	endTime: timestamp("end_time", { withTimezone: true, mode: 'string' }).notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	lastUpdateTime: timestamp("last_update_time", { withTimezone: true, mode: 'string' }).notNull(),
	visible: boolean().notNull(),
	createdById: integer("created_by_id").notNull(),
	tag: text().notNull(),
}, (table) => [
	index("contest_created_by_id_a763ca7e").using("btree", table.createdById.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdById],
			foreignColumns: [user.id],
			name: "contest_created_by_id_a763ca7e_fk_user_id"
		}),
]);

export const flowchartSubmission = pgTable("flowchart_submission", {
	id: text().primaryKey().notNull(),
	mermaidCode: text("mermaid_code").notNull(),
	flowchartData: jsonb("flowchart_data").notNull(),
	status: integer().notNull().$type<FlowchartStatus>(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	aiScore: doublePrecision("ai_score"),
	aiGrade: varchar("ai_grade", { length: 10 }),
	aiFeedback: text("ai_feedback"),
	aiSuggestions: text("ai_suggestions"),
	aiCriteriaDetails: jsonb("ai_criteria_details").notNull(),
	aiProvider: varchar("ai_provider", { length: 50 }).notNull(),
	aiModel: varchar("ai_model", { length: 50 }).notNull(),
	processingTime: doublePrecision("processing_time"),
	evaluationTime: timestamp("evaluation_time", { withTimezone: true, mode: 'string' }),
	problemId: integer("problem_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("flowchart_problem_time_idx").using("btree", table.problemId.asc().nullsLast().op("int4_ops"), table.createTime.asc().nullsLast().op("int4_ops")),
	index("flowchart_status_idx").using("btree", table.status.asc().nullsLast().op("int4_ops")),
	// 流程图列表分页。原来是 hash join 全表再 top-N 排序（4.5ms / 551 buffers），
	// 走这条之后 0.19ms / 47。绝对值不大，但索引只要 64kB，而这张表每行带一大坨
	// jsonb，行数涨上去是线性恶化的。ASC 反向扫，理由同 submission 那几条。
	index("flowchart_create_time_idx").using("btree", table.createTime.asc().nullsLast()),
	index("flowchart_user_time_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.createTime.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "flowchart_submission_problem_id_8551edbf_fk_problem_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "flowchart_submission_user_id_225c83e8_fk_user_id"
		}),
]);

export const message = pgTable("message", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "message_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	message: text().notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	recipientId: integer("recipient_id").notNull(),
	senderId: integer("sender_id").notNull(),
	submissionId: text("submission_id").notNull(),
}, (table) => [
	index("message_recipient_time_idx").using("btree", table.recipientId.asc().nullsLast().op("timestamptz_ops"), table.createTime.asc().nullsLast().op("int4_ops")),
	index("message_sender_id_a2a2e825").using("btree", table.senderId.asc().nullsLast().op("int4_ops")),
	index("message_submission_id_2fdf8a47").using("btree", table.submissionId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.recipientId],
			foreignColumns: [user.id],
			name: "message_recipient_id_2aa5dd76_fk_user_id"
		}),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [user.id],
			name: "message_sender_id_a2a2e825_fk_user_id"
		}),
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [submission.id],
			name: "message_submission_id_2fdf8a47_fk_submission_id"
		}).onDelete("cascade"),
]);

export const judgeServer = pgTable("judge_server", {
	id: serial().primaryKey().notNull(),
	hostname: text().notNull(),
	ip: text(),
	judgerVersion: text("judger_version").notNull(),
	cpuCore: integer("cpu_core").notNull(),
	memoryUsage: doublePrecision("memory_usage").notNull(),
	cpuUsage: doublePrecision("cpu_usage").notNull(),
	lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true, mode: 'string' }).notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	taskNumber: integer("task_number").notNull(),
	serviceUrl: text("service_url"),
	isDisabled: boolean("is_disabled").notNull(),
});

export const exercise = pgTable("exercise", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "exercise_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	type: varchar({ length: 16 }).notNull().$type<ExerciseType>(),
	data: jsonb().notNull(),
	order: integer().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	tutorialId: integer("tutorial_id").notNull(),
}, (table) => [
	index("exercise_tutorial_id_6fd04055").using("btree", table.tutorialId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.tutorialId],
			foreignColumns: [tutorial.id],
			name: "exercise_tutorial_id_6fd04055_fk_tutorial_id"
		}).onDelete("cascade"),
]);

export const optionsSysoptions = pgTable("options_sysoptions", {
	id: serial().primaryKey().notNull(),
	key: text().notNull(),
	value: jsonb().notNull(),
}, (table) => [
	unique("options_sysoptions_key_key").on(table.key),
]);

export const problemset = pgTable("problemset", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "problemset_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	title: text().notNull(),
	description: text().notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	lastUpdateTime: timestamp("last_update_time", { withTimezone: true, mode: 'string' }).notNull(),
	visible: boolean().notNull(),
	difficulty: text().notNull().$type<ProblemSetDifficulty>(),
	status: text().notNull().$type<ProblemSetStatus>(),
	createdById: integer("created_by_id").notNull(),
	endTime: timestamp("end_time", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("problemset_created_by_id_01b5197f").using("btree", table.createdById.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdById],
			foreignColumns: [user.id],
			name: "problemset_created_by_id_01b5197f_fk_user_id"
		}),
]);

export const problemsetProblem = pgTable("problemset_problem", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "problemset_problem_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	order: integer().notNull(),
	isRequired: boolean("is_required").notNull(),
	score: integer().notNull(),
	hint: text(),
	problemId: integer("problem_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	problemsetId: bigint("problemset_id", { mode: "number" }).notNull(),
}, (table) => [
	index("problemset_problem_problem_id_fff2d686").using("btree", table.problemId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "problemset_problem_problem_id_fff2d686_fk_problem_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.problemsetId],
			foreignColumns: [problemset.id],
			name: "problemset_problem_problemset_id_350d17fb_fk_problemset_id"
		}).onDelete("cascade"),
	unique("unique_problemset_problem").on(table.problemId, table.problemsetId),
]);

export const problemsetProgress = pgTable("problemset_progress", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "problemset_progress_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	joinTime: timestamp("join_time", { withTimezone: true, mode: 'string' }).notNull(),
	completeTime: timestamp("complete_time", { withTimezone: true, mode: 'string' }),
	isCompleted: boolean("is_completed").notNull(),
	progressPercentage: doublePrecision("progress_percentage").notNull(),
	completedProblemsCount: integer("completed_problems_count").notNull(),
	totalProblemsCount: integer("total_problems_count").notNull(),
	totalScore: integer("total_score").notNull(),
	progressDetail: jsonb("progress_detail").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	problemsetId: bigint("problemset_id", { mode: "number" }).notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("problemset_progress_user_id_c8041a80").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemsetId],
			foreignColumns: [problemset.id],
			name: "problemset_progress_problemset_id_20a9632e_fk_problemset_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "problemset_progress_user_id_c8041a80_fk_user_id"
		}),
	unique("unique_problemset_progress_user").on(table.problemsetId, table.userId),
]);

export const problemsetSubmission = pgTable("problemset_submission", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "problemset_submission_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	problemId: integer("problem_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	problemsetId: bigint("problemset_id", { mode: "number" }).notNull(),
	submissionId: text("submission_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("problemset__problem_1f39fa_idx").using("btree", table.problemsetId.asc().nullsLast().op("int4_ops"), table.userId.asc().nullsLast().op("int4_ops")),
	index("problemset__problem_22f053_idx").using("btree", table.problemsetId.asc().nullsLast().op("int8_ops"), table.problemId.asc().nullsLast().op("int8_ops")),
	index("problemset__user_id_2f1501_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	index("problemset_submission_problem_id_5629b105").using("btree", table.problemId.asc().nullsLast().op("int4_ops")),
	index("problemset_submission_submission_id_78e2b807").using("btree", table.submissionId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "problemset_submission_problem_id_5629b105_fk_problem_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.problemsetId],
			foreignColumns: [problemset.id],
			name: "problemset_submission_problemset_id_85290e17_fk_problemset_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [submission.id],
			name: "problemset_submission_submission_id_78e2b807_fk_submission_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "problemset_submission_user_id_915fc9c6_fk_user_id"
		}),
]);

export const reaction = pgTable("reaction", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "reaction_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	type: varchar({ length: 20 }).notNull().$type<ReactionKey>(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	problemId: integer("problem_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("reaction_problem_type_idx").using("btree", table.problemId.asc().nullsLast().op("int4_ops"), table.type.asc().nullsLast().op("int4_ops")),
	index("reaction_user_id_cfa7f469").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "reaction_problem_id_a7f3b9f3_fk_problem_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "reaction_user_id_cfa7f469_fk_user_id"
		}),
	unique("reaction_problem_user_unique").on(table.problemId, table.userId),
]);

export const problem = pgTable("problem", {
	id: serial().primaryKey().notNull(),
	title: text().notNull(),
	description: text().notNull(),
	inputDescription: text("input_description").notNull(),
	outputDescription: text("output_description").notNull(),
	samples: jsonb().notNull(),
	testCaseId: text("test_case_id").notNull(),
	testCaseScore: jsonb("test_case_score").notNull(),
	hint: text(),
	languages: jsonb().notNull().$type<ProblemLanguage[]>(),
	template: jsonb().notNull().$type<Record<string, string>>(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	lastUpdateTime: timestamp("last_update_time", { withTimezone: true, mode: 'string' }),
	timeLimit: integer("time_limit").notNull(),
	memoryLimit: integer("memory_limit").notNull(),
	visible: boolean().default(true).notNull(),
	difficulty: text().notNull().$type<ProblemDifficulty>(),
	source: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	submissionNumber: bigint("submission_number", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	acceptedNumber: bigint("accepted_number", { mode: "number" }).default(0).notNull(),
	createdById: integer("created_by_id").notNull(),
	displayId: text("_id").notNull(),
	statisticInfo: jsonb("statistic_info").default({}).notNull(),
	contestId: integer("contest_id"),
	isPublic: boolean("is_public").default(false).notNull(),
	/**
	 * 已停用。「提交互相可见」的两个开关（这个是题目级，submission.shared 是单条级）
	 * 连同判定分支一起删掉了：生产库 956 道题里只有 2 道打开过，还都是比赛题
	 * （比赛未结束时那条分支根本走不到），出题页也从来没给过开关。
	 * 列保留不删：删列是破坏性迁移，而留着不写不读没有任何代价。
	 */
	shareSubmission: boolean("share_submission").default(false).notNull(),
	prompt: text(),
	answers: jsonb(),
	allowFlowchart: boolean("allow_flowchart").default(false).notNull(),
	flowchartData: jsonb("flowchart_data").default({}).notNull(),
	flowchartHint: text("flowchart_hint"),
	mermaidCode: text("mermaid_code"),
	showFlowchart: boolean("show_flowchart").default(false).notNull(),
	astRules: jsonb("ast_rules").$type<AstRules>(),
	sqlConfig: jsonb("sql_config").$type<SqlConfig>(),
	sqlDisplay: jsonb("sql_display").$type<SqlDisplay>(),
}, (table) => [
	index("problem_contest_visible_idx").using("btree", table.contestId.asc().nullsLast().op("bool_ops"), table.visible.asc().nullsLast().op("int4_ops")),
	index("problem_created_by_id_cb362143").using("btree", table.createdById.asc().nullsLast().op("int4_ops")),
	index("problem_visible_idx").using("btree", table.visible.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.contestId],
			foreignColumns: [contest.id],
			name: "problem_contest_id_328e013a_fk_contest_id"
		}),
	foreignKey({
			columns: [table.createdById],
			foreignColumns: [user.id],
			name: "problem_created_by_id_cb362143_fk_user_id"
		}),
	unique("unique_problem_id_contest").on(table.displayId, table.contestId),
]);

export const problemTags = pgTable("problem_tags", {
	id: serial().primaryKey().notNull(),
	problemId: integer("problem_id").notNull(),
	problemtagId: integer("problemtag_id").notNull(),
}, (table) => [
	index("problem_tags_problemtag_id_72d20571").using("btree", table.problemtagId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "problem_tags_problem_id_866ecb8d_fk_problem_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.problemtagId],
			foreignColumns: [problemTag.id],
			name: "problem_tags_problemtag_id_72d20571_fk_problem_tag_id"
		}).onDelete("cascade"),
	unique("problem_tags_problem_id_problemtag_id_318459d1_uniq").on(table.problemId, table.problemtagId),
]);

export const problemTag = pgTable("problem_tag", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
}, (table) => [
	uniqueIndex("problem_tag_name_ci_unique").using("btree", sql`lower(name)`),
]);

export const submission = pgTable("submission", {
	id: text().primaryKey().notNull(),
	contestId: integer("contest_id"),
	problemId: integer("problem_id").notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	userId: integer("user_id").notNull(),
	code: text().notNull(),
	result: integer().default(6).notNull().$type<JudgeStatus>(),
	info: jsonb().default({}).notNull(),
	language: text().notNull().$type<ProblemLanguage>(),
	/**
	 * 已停用，见 problem.share_submission 的说明。历史上 12.3 万条提交里有 40 条
	 * 为真（2022 年 39 条、2023 年 1 条），入口在更早的那版前端上，ojnext 和 OJ2
	 * 都没有把它搬过来。现在没有任何代码读写它，行里的历史值原样留着。
	 */
	shared: boolean().default(false).notNull(),
	statisticInfo: jsonb("statistic_info").default({}).notNull(),
	username: text().notNull(),
	// 来源题单：学生从题单入口（/problemset/:id/problem/:pid）提交时记下来，
	// 提交列表据此标出「这条来自题单」。**只是来源标记**，题单进度、奖章一概不看它，
	// 那些由判完之后的 recordSolvedProblem 按「已加入且含这道题的所有题单」记账。
	// 老数据里只有迁移 0007 从 problemset_submission 回填的首次 AC 有值。
	problemsetId: bigint("problemset_id", { mode: "number" }),
}, (table) => [
	// 同上，不写 .op()。原先 pull 出来的 opclass 还串了位（contest_id 标成 timestamptz_ops、
	// create_time 标成 int4_ops），那条 SQL 真拿去执行 Postgres 会直接拒绝。
	index("contest_create_time_idx").using("btree", table.contestId.asc().nullsLast(), table.createTime.desc().nullsFirst()),
	// 提交列表默认视图（WHERE contest_id IS NULL ORDER BY create_time DESC, id DESC）专用。
	// 上面的 contest_create_time_idx 看着能覆盖，但 Postgres 不把 `contest_id IS NULL`
	// 当成能吃掉首列、从而继承第二列有序性的等值条件——把 seqscan/bitmapscan 全关掉逼它
	// 也不肯用，只会走单列 contest_id 索引再全量排序。结果是每翻一页都 Parallel Seq Scan
	// 扫完整张表 + top-N 排序。改用部分索引后谓词由索引本身保证，排序序就是索引序。
	// 生产快照（12.3 万条提交）实测：61.8ms / 18936 blocks → 0.22ms / 34 blocks。
	// 这个索引不在 Django 的 migration 里，是 OJ2 单独加的，见 src/db/0001。
	//
	// 带上 id 是为了让排序成为**全序**，深翻页的游标转换（routes/submission.ts 的
	// paginateSubmissionRows）才精确。create_time 由 `new Date().toISOString()` 生成，
	// 只有毫秒精度，同毫秒的两条提交靠 create_time 分不出先后：游标用 `<=` 回查时，
	// 上一页的末行会重新出现在下一页页首。加上 id 之后两步用的是同一个全序，不会错位。
	// 索引从 2.3MB 涨到 6.9MB，快照实测第一步 5.7ms → 8.9ms，换精确值得。
	//
	// 两列都建成默认的 ASC NULLS LAST，靠 Index Only Scan **Backward** 服务
	// `ORDER BY create_time DESC, id DESC`。别照着 ORDER BY 写成 .desc()：Postgres 里
	// `ORDER BY x DESC` 默认是 NULLS FIRST，而 `CREATE INDEX ... (x DESC)` 默认是
	// NULLS LAST，两边 nulls 位置对不上，规划器就当这条索引出不了序——实测建成
	// DESC NULLS LAST 之后深翻页退化成 external merge sort（5.2MB 落盘），比不建还糟。
	// 两列同为 ASC 时整条索引反着扫就是精确的反序，所以反而是能用的那一种。
	// 这两列都 NOT NULL，nulls 位置在语义上无所谓，纯粹是规划器的匹配规则。
	index("submission_public_create_time_id_idx").using("btree", table.createTime.asc().nullsLast(), table.id.asc().nullsLast()).where(sql`${table.contestId} is null`),
	/**
	 * Django 给每个外键都自动建了一个单列索引，`db_index=True` 的还会多一个
	 * `_like`（text_pattern_ops）。0012 把其中 21 个删了 —— 它们的列都是某个
	 * 复合索引的**最左前缀**，规划器本来就走那一个，多出来的只是每次写入要多维护
	 * 一棵树。这张表上删的三个是 contest_id / problem_id / user_id，分别被下面
	 * 的 contest_create_time_idx、problem_user_idx、user_create_time_idx 覆盖。
	 *
	 * 加新索引时先看一眼有没有现成的复合索引已经以它打头，别把这批又建回来。
	 */
	index("problem_user_idx").using("btree", table.problemId.asc().nullsLast().op("int4_ops"), table.userId.asc().nullsLast().op("int4_ops")),
	/**
	 * `submission_result_37e2f67a` 是 Django 建的单列索引，**别当成被下面
	 * submission_result_time_idx 覆盖了就删**：那个是 `WHERE contest_id IS NULL`
	 * 的部分索引，管不了「全库含比赛按 result 统计」那类查询（实测删掉之后
	 * `count(*) where result in (6,7)` 从走索引掉回 75ms 全表扫）。856kB，留着。
	 */
	index("submission_result_37e2f67a").using("btree", table.result.asc().nullsLast().op("int4_ops")),
	index("user_create_time_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.createTime.asc().nullsLast().op("timestamptz_ops")),
	/**
	 * 提交列表的「语言」和「结果」两个下拉筛选。原来这两列上要么没索引、要么只有
	 * 不带 `contest_id IS NULL` 的单列索引，翻页那条靠 submission_public_create_time_id_idx
	 * 边扫边滤还能对付，**count 那条只能全表扫**（快照实测固定 75~82ms / 18448 buffers，
	 * 筛什么值都一样）。加完：语言 count 80ms → 11ms（Python3，占 8 成）/ 1.6ms（C），
	 * 结果 count 75ms → 2.0ms。
	 *
	 * 更要命的是冷门语言的**翻页**：Python2 只有 3 条、全是 2022 年的，分页索引得从
	 * 最新一路倒扫到底才凑够一页，43ms 全表扫；走这条索引是 0.02ms。
	 *
	 * 两列都 ASC NULLS LAST，理由同上面 submission_public_create_time_id_idx ——
	 * 靠 Index Scan **Backward** 出 `ORDER BY create_time DESC`。这里再实测了一遍：
	 * 写成 DESC NULLS LAST 规划器直接不认这条索引，回落到分页索引带 Filter。
	 */
	index("submission_language_time_idx").using("btree", table.language.asc().nullsLast(), table.createTime.asc().nullsLast()).where(sql`${table.contestId} is null`),
	index("submission_result_time_idx").using("btree", table.result.asc().nullsLast(), table.createTime.asc().nullsLast()).where(sql`${table.contestId} is null`),
	/**
	 * 覆盖索引，专门给「在全部公开提交上做聚合」那几个接口用：教师统计不填班级、
	 * 活跃榜、题目 AC 趋势。它们慢的**不是聚合本身，是为了读这四个小列把 145MB 的堆
	 * 翻一遍** —— `code` 和 `info` 占了这张表的绝大部分体积，聚合一列都用不上。
	 *
	 * 有了它这些查询走 Index Only Scan，只读 6MB。快照实测：
	 * 教师统计全站 186ms → 49ms（还消掉了 4.2MB 的落盘排序）、活跃榜 108ms → 18ms、
	 * AC 趋势 120ms → 41ms，buffers 一律从 18000+ 掉到 2000 以内。
	 *
	 * 列序按 user_id 打头：三个查询里两个按人分组，能省掉排序。加列要谨慎 ——
	 * 多一列就多一份 10 万行的拷贝，而它的价值全在「窄」上。
	 */
	index("submission_public_metrics_idx").using("btree", table.userId.asc().nullsLast(), table.problemId.asc().nullsLast(), table.result.asc().nullsLast(), table.createTime.asc().nullsLast()).where(sql`${table.contestId} is null`),
	foreignKey({
			columns: [table.contestId],
			foreignColumns: [contest.id],
			name: "submission_contest_id_775716d5_fk_contest_id"
		}),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "submission_problem_id_76847b55_fk_problem_id"
		}),
	// 部分索引：绝大多数提交不来自题单，全列索引等于给 12 万行白建一遍。
	// 谓词是 IS NOT NULL，`problemset_id = $1` 蕴含非空，所以删题单时的外键检查
	// 也能用上它——不然那条检查要顺序扫全表。
	index("submission_problemset_id_idx").using("btree", table.problemsetId.asc().nullsLast()).where(sql`${table.problemsetId} is not null`),
	// 删掉题单不该带走提交：置空来源标记就行，提交本身照旧存在。
	foreignKey({
			columns: [table.problemsetId],
			foreignColumns: [problemset.id],
			name: "submission_problemset_id_fk_problemset_id"
		}).onDelete("set null"),
]);

export const tutorial = pgTable("tutorial", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "tutorial_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	title: varchar({ length: 128 }).notNull(),
	content: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	isPublic: boolean("is_public").notNull(),
	order: integer().notNull(),
	createdById: integer("created_by_id").notNull(),
	code: text(),
	type: varchar({ length: 10 }).notNull().$type<TutorialType>(),
}, (table) => [
	index("tutorial_created_by_id_07973cab").using("btree", table.createdById.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdById],
			foreignColumns: [user.id],
			name: "tutorial_created_by_id_07973cab_fk_user_id"
		}),
]);

export const userStat = pgTable("user_stat", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "user_stat_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	metrics: jsonb().default({}).notNull(),
	updateTime: timestamp("update_time", { withTimezone: true, mode: 'string' }).notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_stat_user_id_73337fc0_fk_user_id"
		}).onDelete("cascade"),
	unique("user_stat_user_id_key").on(table.userId),
]);

export const userAchievement = pgTable("user_achievement", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "user_achievement_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	unlockTime: timestamp("unlock_time", { withTimezone: true, mode: 'string' }).notNull(),
	backfilled: boolean().default(false).notNull(),
	notified: boolean().default(false).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	achievementId: bigint("achievement_id", { mode: "number" }).notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("user_achievement_achievement_id_29db600d").using("btree", table.achievementId.asc().nullsLast().op("int8_ops")),
	index("user_achv_notified_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.notified.asc().nullsLast().op("bool_ops")),
	index("user_achv_time_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.unlockTime.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.achievementId],
			foreignColumns: [achievement.id],
			name: "user_achievement_achievement_id_29db600d_fk_achievement_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_achievement_user_id_b8ec7d6a_fk_user_id"
		}),
	unique("unique_user_achievement").on(table.achievementId, table.userId),
]);

export const userBadge = pgTable("user_badge", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "user_badge_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	earnedTime: timestamp("earned_time", { withTimezone: true, mode: 'string' }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	badgeId: bigint("badge_id", { mode: "number" }).notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("user_badge_badge_id_92a983e9").using("btree", table.badgeId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.badgeId],
			foreignColumns: [problemsetBadge.id],
			name: "user_badge_badge_id_92a983e9_fk_problemset_badge_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_badge_user_id_a286d718_fk_user_id"
		}),
	unique("unique_user_badge").on(table.badgeId, table.userId),
]);

export const userProfile = pgTable("user_profile", {
	id: serial().primaryKey().notNull(),
	acmProblemsStatus: jsonb("acm_problems_status").default({}).notNull().$type<Record<string, unknown>>(),
	avatar: text().notNull(),
	mood: text(),
	acceptedNumber: integer("accepted_number").default(0).notNull(),
	submissionNumber: integer("submission_number").default(0).notNull(),
	userId: integer("user_id").notNull(),
	realName: text("real_name"),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_profile_user_id_8fdce8e2_fk_user_id"
		}).onDelete("cascade"),
	unique("user_profile_user_id_key").on(table.userId),
]);

export const acmContestRank = pgTable("acm_contest_rank", {
	id: serial().primaryKey().notNull(),
	submissionNumber: integer("submission_number").default(0).notNull(),
	acceptedNumber: integer("accepted_number").default(0).notNull(),
	totalTime: integer("total_time").default(0).notNull(),
	submissionInfo: jsonb("submission_info").default({}).notNull().$type<Record<string, ContestSubmissionInfo>>(),
	contestId: integer("contest_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("acm_rank_contest_user_idx").using("btree", table.contestId.asc().nullsLast().op("int4_ops"), table.userId.asc().nullsLast().op("int4_ops")),
	index("acm_rank_order_idx").using("btree", table.contestId.asc().nullsLast().op("int4_ops"), table.acceptedNumber.asc().nullsLast().op("int4_ops"), table.totalTime.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.contestId],
			foreignColumns: [contest.id],
			name: "acm_contest_rank_contest_id_21030ccd_fk_contest_id"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "acm_contest_rank_user_id_40391ab2_fk_user_id"
		}),
	unique("unique_acm_rank_user_contest").on(table.contestId, table.userId),
]);

export const user = pgTable("user", {
	id: serial().primaryKey().notNull(),
	password: varchar({ length: 128 }).notNull(),
	lastLogin: timestamp("last_login", { withTimezone: true, mode: 'string' }),
	username: text().notNull(),
	email: text(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }),
	// $type 只是 TS 层的收窄，不产生任何 SQL —— 让 eq(schema.user.adminType, "...")
	// 里的角色名也受类型检查。运行时的兜底仍在 auth/session.ts 的 toAdminType。
	adminType: text("admin_type").notNull().$type<AdminType>(),
	isDisabled: boolean("is_disabled").default(false).notNull(),
	problemPermission: text("problem_permission").notNull().$type<ProblemPermission>(),
	rawPassword: varchar("raw_password", { length: 20 }),
	className: text("class_name"),
}, (table) => [
	unique("user_username_key").on(table.username),
	// 「近两年登录过的活跃人数」—— problems/:id/beat-count 每次打开题目详情都要算一遍，
	// 而这张表原来只有主键和 username 两个索引，那句统计是全表扫。
	index("user_active_idx").using("btree", table.isDisabled.asc().nullsLast(), table.lastLogin.desc().nullsFirst()),
	// 按班级 / 按年级（class_name like '241%'）取学生：班级榜、班级对比、AI 学情的
	// 排名 scope 都走它，见 routes/classroom.ts 的 loadClassUsers。
	index("user_class_name_idx").using("btree", table.className.asc().nullsLast()),
]);

export const problemsetBadge = pgTable("problemset_badge", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "problemset_badge_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	name: text().notNull(),
	description: text().notNull(),
	icon: text().notNull(),
	conditionType: text("condition_type").notNull().$type<BadgeConditionType>(),
	conditionValue: integer("condition_value").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	problemsetId: bigint("problemset_id", { mode: "number" }).notNull(),
}, (table) => [
	index("problemset_badge_problemset_id_6cb6c74f").using("btree", table.problemsetId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.problemsetId],
			foreignColumns: [problemset.id],
			name: "problemset_badge_problemset_id_6cb6c74f_fk_problemset_id"
		}).onDelete("cascade"),
]);

/**
 * 自学模块的留痕：一个学生 × 一课一行。
 *
 * OJ2 自己建的表，不是 Django 遗留，所以没有代理主键 —— 写入路径只有一条 upsert，
 * 冲突目标就是 (user_id, tutorial_id)，再挂个 id 序列没有任何用处。
 *
 * **只记「读到哪一课 + 停留多久」，不记练一练的作答。** 练习的对错全在浏览器里判
 * （见 apps/web/src/oj/learn/components/），学生可以随便重试到对为止，上报上来也只是
 * 「他按了几次按钮」，不构成教学证据，还要为此多养一张按人按题膨胀的表。
 *
 * 外键这里**用了库级 CASCADE**，和 Django 建的那些 NO ACTION 外键不同：删教程、删用户
 * 都不必再记得回来手工清一遍子表（后台删教程的事务里就没清它，靠的就是这里）。
 */
export const tutorialProgress = pgTable("tutorial_progress", {
	userId: integer("user_id").notNull(),
	tutorialId: integer("tutorial_id").notNull(),
	// 打开次数。只有「进入这一课」才 +1，后续补时长的心跳不动它
	viewCount: integer("view_count").default(0).notNull(),
	// 累计停留秒数。前端只在页面可见、且人没挂机时计时，见 useLearnTrace.ts
	totalSeconds: integer("total_seconds").default(0).notNull(),
	firstViewedAt: timestamp("first_viewed_at", { withTimezone: true, mode: 'string' }).notNull(),
	lastViewedAt: timestamp("last_viewed_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	primaryKey({ columns: [table.userId, table.tutorialId], name: "tutorial_progress_pkey" }),
	// 按课汇总（「这一课全班多少人读过」）要扫这一列，主键的前缀索引帮不上忙
	index("tutorial_progress_tutorial_id_idx").on(table.tutorialId),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "tutorial_progress_user_id_fk_user_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tutorialId],
			foreignColumns: [tutorial.id],
			name: "tutorial_progress_tutorial_id_fk_tutorial_id"
		}).onDelete("cascade"),
]);

/**
 * 练一练的留痕：一个学生 × 一道练习一行。
 *
 * 存的是**聚合**，不是流水：试了几次、错了几次、做没做对、第几次做对的、
 * 最后一次做错时填的什么。一道题一个学生一行，全校封顶就是「学生数 × 练习数」，
 * 而流水会随着学生反复点「提交」无限长 —— 而且多存的那些行回答不了任何新问题：
 * 「他第 3 次和第 5 次都选了 B」对老师没有意义，「他试了 7 次才对」有。
 *
 * `lastWrongAnswer` 存的是**前端拼好的一句人话**（「选了 A、C」「第 2 空填了 xy」），
 * 不是原始作答结构：七种题型的作答形状各不相同，存结构就得在后台按题型各写一套
 * 渲染，而老师要看的只是「他错在哪」。前端本来就知道怎么把自己的作答说成人话。
 */
export const exerciseAttempt = pgTable("exercise_attempt", {
	userId: integer("user_id").notNull(),
	exerciseId: integer("exercise_id").notNull(),
	// 提交次数。同一份答案连点两次只算一次，见 ExerciseWidget.vue 的去重
	attempts: integer().default(0).notNull(),
	wrongAttempts: integer("wrong_attempts").default(0).notNull(),
	solved: boolean().default(false).notNull(),
	// 第一次做对时累计试了几次。做对之后就不再变 —— 后面再点提交不该把它改大
	attemptsToSolve: integer("attempts_to_solve"),
	lastWrongAnswer: text("last_wrong_answer"),
	firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true, mode: 'string' }).notNull(),
	lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: 'string' }).notNull(),
	solvedAt: timestamp("solved_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	primaryKey({ columns: [table.userId, table.exerciseId], name: "exercise_attempt_pkey" }),
	// 按题汇总（「这道题全班多少人做对」）要扫这一列
	index("exercise_attempt_exercise_id_idx").on(table.exerciseId),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "exercise_attempt_user_id_fk_user_id"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.exerciseId],
			foreignColumns: [exercise.id],
			name: "exercise_attempt_exercise_id_fk_exercise_id"
		}).onDelete("cascade"),
]);
