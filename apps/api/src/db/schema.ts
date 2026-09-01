// 本文件由 `drizzle-kit pull` 从生产库自动生成，之后按下面几条手工维护。
//
// 2026-08-26：旧 Django 后端下线，7 张框架表（auth_group、auth_group_permissions、
// auth_permission、django_content_type、django_dramatiq_task、django_migrations、
// django_session）已由 0002_drop_django_leftovers 删除，drizzle.config.ts 的
// tablesFilter 随之移除。库里现在就是这 27 张业务表。
//
// 手工修正（都是 `pull` 自己没法无损 round-trip 的地方，改回去会让 generate 产生假 diff，
// 详见 CLAUDE.md「改 schema 走 drizzle migration」）：
//   * bigint identity 的 maxValue 用字符串，不能写成 JS number 字面量（会丢精度）。
//   * 索引不写 `.desc()`，生成 SQL 时方向会被丢掉。
//
// 关于 10 张表的 bigint id（problemset*、achievement、user_achievement、user_stat、
// user_badge、ai_analysis）：这是历史巧合不是设计——这些 app 的 0001_initial 生成时
// Django 还没设 DEFAULT_AUTO_FIELD，用了 3.2+ 的默认 BigAutoField；更早的表（user、
// problem、contest、submission）都是 int4。现存最大 id 一万出头，确实都用不上 bigint，
// 但 2026-08-26 评估后决定**不改**：省 4 字节/行毫无意义，ALTER TYPE 要重写整表并拿
// ACCESS EXCLUSIVE 锁，而且其中 6 处 id 被外键绑着得连坐。别再提这件事了。
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
	rarity: text().notNull(),
	hidden: boolean().default(false).notNull(),
	metric: text().notNull(),
	operator: text().notNull(),
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
	allowedIpRanges: jsonb("allowed_ip_ranges").notNull(),
	tag: text().notNull(),
}, (table) => [
	index("contest_created_by_id_a763ca7e").using("btree", table.createdById.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdById],
			foreignColumns: [user.id],
			name: "contest_created_by_id_a763ca7e_fk_user_id"
		}),
]);

export const contestAnnouncement = pgTable("contest_announcement", {
	id: serial().primaryKey().notNull(),
	title: text().notNull(),
	content: text().notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	contestId: integer("contest_id").notNull(),
	createdById: integer("created_by_id").notNull(),
	visible: boolean().notNull(),
}, (table) => [
	index("contest_announcement_contest_id_a8cb419f").using("btree", table.contestId.asc().nullsLast().op("int4_ops")),
	index("contest_announcement_created_by_id_469a14ce").using("btree", table.createdById.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.contestId],
			foreignColumns: [contest.id],
			name: "contest_announcement_contest_id_a8cb419f_fk_contest_id"
		}),
	foreignKey({
			columns: [table.createdById],
			foreignColumns: [user.id],
			name: "contest_announcement_created_by_id_469a14ce_fk_user_id"
		}),
]);

export const flowchartSubmission = pgTable("flowchart_submission", {
	id: text().primaryKey().notNull(),
	mermaidCode: text("mermaid_code").notNull(),
	flowchartData: jsonb("flowchart_data").notNull(),
	status: integer().notNull(),
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
	index("flowchart_submission_id_0dbfc4f9_like").using("btree", table.id.asc().nullsLast().op("text_pattern_ops")),
	index("flowchart_submission_problem_id_8551edbf").using("btree", table.problemId.asc().nullsLast().op("int4_ops")),
	index("flowchart_submission_user_id_225c83e8").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	index("flowchart_user_time_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.createTime.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "flowchart_submission_problem_id_8551edbf_fk_problem_id"
		}),
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
	index("message_recipient_id_2aa5dd76").using("btree", table.recipientId.asc().nullsLast().op("int4_ops")),
	index("message_recipient_time_idx").using("btree", table.recipientId.asc().nullsLast().op("timestamptz_ops"), table.createTime.asc().nullsLast().op("int4_ops")),
	index("message_sender_id_a2a2e825").using("btree", table.senderId.asc().nullsLast().op("int4_ops")),
	index("message_submission_id_2fdf8a47").using("btree", table.submissionId.asc().nullsLast().op("text_ops")),
	index("message_submission_id_2fdf8a47_like").using("btree", table.submissionId.asc().nullsLast().op("text_pattern_ops")),
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
		}),
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
	type: varchar({ length: 16 }).notNull(),
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
		}),
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
	difficulty: text().notNull(),
	status: text().notNull(),
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
	index("problemset_problem_problemset_id_350d17fb").using("btree", table.problemsetId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "problemset_problem_problem_id_fff2d686_fk_problem_id"
		}),
	foreignKey({
			columns: [table.problemsetId],
			foreignColumns: [problemset.id],
			name: "problemset_problem_problemset_id_350d17fb_fk_problemset_id"
		}),
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
	index("problemset_progress_problemset_id_20a9632e").using("btree", table.problemsetId.asc().nullsLast().op("int8_ops")),
	index("problemset_progress_user_id_c8041a80").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemsetId],
			foreignColumns: [problemset.id],
			name: "problemset_progress_problemset_id_20a9632e_fk_problemset_id"
		}),
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
	index("problemset_submission_problemset_id_85290e17").using("btree", table.problemsetId.asc().nullsLast().op("int8_ops")),
	index("problemset_submission_submission_id_78e2b807").using("btree", table.submissionId.asc().nullsLast().op("text_ops")),
	index("problemset_submission_submission_id_78e2b807_like").using("btree", table.submissionId.asc().nullsLast().op("text_pattern_ops")),
	index("problemset_submission_user_id_915fc9c6").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "problemset_submission_problem_id_5629b105_fk_problem_id"
		}),
	foreignKey({
			columns: [table.problemsetId],
			foreignColumns: [problemset.id],
			name: "problemset_submission_problemset_id_85290e17_fk_problemset_id"
		}),
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [submission.id],
			name: "problemset_submission_submission_id_78e2b807_fk_submission_id"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "problemset_submission_user_id_915fc9c6_fk_user_id"
		}),
]);

export const reaction = pgTable("reaction", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "reaction_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	type: varchar({ length: 20 }).notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	problemId: integer("problem_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("reaction_problem_id_a7f3b9f3").using("btree", table.problemId.asc().nullsLast().op("int4_ops")),
	index("reaction_problem_type_idx").using("btree", table.problemId.asc().nullsLast().op("int4_ops"), table.type.asc().nullsLast().op("int4_ops")),
	index("reaction_user_id_cfa7f469").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "reaction_problem_id_a7f3b9f3_fk_problem_id"
		}),
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
	languages: jsonb().notNull(),
	template: jsonb().notNull(),
	createTime: timestamp("create_time", { withTimezone: true, mode: 'string' }).notNull(),
	lastUpdateTime: timestamp("last_update_time", { withTimezone: true, mode: 'string' }),
	timeLimit: integer("time_limit").notNull(),
	memoryLimit: integer("memory_limit").notNull(),
	visible: boolean().default(true).notNull(),
	difficulty: text().notNull(),
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
	shareSubmission: boolean("share_submission").default(false).notNull(),
	prompt: text(),
	answers: jsonb(),
	allowFlowchart: boolean("allow_flowchart").default(false).notNull(),
	flowchartData: jsonb("flowchart_data").default({}).notNull(),
	flowchartHint: text("flowchart_hint"),
	mermaidCode: text("mermaid_code"),
	showFlowchart: boolean("show_flowchart").default(false).notNull(),
	astRules: jsonb("ast_rules"),
	sqlConfig: jsonb("sql_config"),
	sqlDisplay: jsonb("sql_display"),
}, (table) => [
	index("problem__id_919b1d80").using("btree", table.displayId.asc().nullsLast().op("text_ops")),
	index("problem_contest_id_328e013a").using("btree", table.contestId.asc().nullsLast().op("int4_ops")),
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
	index("problem_tags_problem_id_866ecb8d").using("btree", table.problemId.asc().nullsLast().op("int4_ops")),
	index("problem_tags_problemtag_id_72d20571").using("btree", table.problemtagId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.problemId],
			foreignColumns: [problem.id],
			name: "problem_tags_problem_id_866ecb8d_fk_problem_id"
		}),
	foreignKey({
			columns: [table.problemtagId],
			foreignColumns: [problemTag.id],
			name: "problem_tags_problemtag_id_72d20571_fk_problem_tag_id"
		}),
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
	result: integer().default(6).notNull(),
	info: jsonb().default({}).notNull(),
	language: text().notNull(),
	shared: boolean().default(false).notNull(),
	statisticInfo: jsonb("statistic_info").default({}).notNull(),
	username: text().notNull(),
	ip: text(),
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
	index("problem_user_idx").using("btree", table.problemId.asc().nullsLast().op("int4_ops"), table.userId.asc().nullsLast().op("int4_ops")),
	index("submission_contest_id_775716d5").using("btree", table.contestId.asc().nullsLast().op("int4_ops")),
	index("submission_problem_id_76847b55").using("btree", table.problemId.asc().nullsLast().op("int4_ops")),
	index("submission_result_37e2f67a").using("btree", table.result.asc().nullsLast().op("int4_ops")),
	index("submission_user_id_3779a8c1").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	index("user_create_time_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.createTime.asc().nullsLast().op("timestamptz_ops")),
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
	type: varchar({ length: 10 }).notNull(),
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
		}),
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
	index("user_achievement_user_id_b8ec7d6a").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	index("user_achv_notified_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.notified.asc().nullsLast().op("bool_ops")),
	index("user_achv_time_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.unlockTime.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.achievementId],
			foreignColumns: [achievement.id],
			name: "user_achievement_achievement_id_29db600d_fk_achievement_id"
		}),
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
	index("user_badge_user_id_a286d718").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.badgeId],
			foreignColumns: [problemsetBadge.id],
			name: "user_badge_badge_id_92a983e9_fk_problemset_badge_id"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_badge_user_id_a286d718_fk_user_id"
		}),
	unique("unique_user_badge").on(table.badgeId, table.userId),
]);

export const userProfile = pgTable("user_profile", {
	id: serial().primaryKey().notNull(),
	acmProblemsStatus: jsonb("acm_problems_status").default({}).notNull(),
	avatar: text().notNull(),
	blog: varchar({ length: 200 }),
	mood: text(),
	acceptedNumber: integer("accepted_number").default(0).notNull(),
	submissionNumber: integer("submission_number").default(0).notNull(),
	github: text(),
	school: text(),
	major: text(),
	userId: integer("user_id").notNull(),
	realName: text("real_name"),
	language: text(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_profile_user_id_8fdce8e2_fk_user_id"
		}),
	unique("user_profile_user_id_key").on(table.userId),
]);

export const acmContestRank = pgTable("acm_contest_rank", {
	id: serial().primaryKey().notNull(),
	submissionNumber: integer("submission_number").default(0).notNull(),
	acceptedNumber: integer("accepted_number").default(0).notNull(),
	totalTime: integer("total_time").default(0).notNull(),
	submissionInfo: jsonb("submission_info").default({}).notNull(),
	contestId: integer("contest_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("acm_contest_rank_contest_id_21030ccd").using("btree", table.contestId.asc().nullsLast().op("int4_ops")),
	index("acm_contest_rank_user_id_40391ab2").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
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
	adminType: text("admin_type").notNull(),
	authToken: text("auth_token"),
	openApi: boolean("open_api").default(false).notNull(),
	openApiAppkey: text("open_api_appkey"),
	isDisabled: boolean("is_disabled").default(false).notNull(),
	problemPermission: text("problem_permission").notNull(),
	sessionKeys: jsonb("session_keys").default([]).notNull(),
	rawPassword: varchar("raw_password", { length: 20 }),
	className: text("class_name"),
}, (table) => [
	unique("user_username_key").on(table.username),
]);

export const problemsetBadge = pgTable("problemset_badge", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "problemset_badge_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	name: text().notNull(),
	description: text().notNull(),
	icon: text().notNull(),
	conditionType: text("condition_type").notNull(),
	conditionValue: integer("condition_value").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	problemsetId: bigint("problemset_id", { mode: "number" }).notNull(),
}, (table) => [
	index("problemset_badge_problemset_id_6cb6c74f").using("btree", table.problemsetId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.problemsetId],
			foreignColumns: [problemset.id],
			name: "problemset_badge_problemset_id_6cb6c74f_fk_problemset_id"
		}),
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
