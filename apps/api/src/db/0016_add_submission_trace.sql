-- 提交的编辑过程信号（AI 时代 OJ 设计的第 1 步：过程信号采集），字段含义见 schema.ts 的
-- submissionTrace 与契约的 submissionTraceSchema。纯建表，历史提交没有对应行，这是预期的。
CREATE TABLE "submission_trace" (
	"submission_id" text PRIMARY KEY NOT NULL,
	"active_ms" integer NOT NULL,
	"since_open_ms" integer NOT NULL,
	"typed_chars" integer NOT NULL,
	"pasted_chars" integer NOT NULL,
	"paste_count" integer NOT NULL,
	"max_paste" integer NOT NULL,
	"deleted_chars" integer NOT NULL,
	"blur_count" integer NOT NULL,
	"initial_len" integer NOT NULL,
	"collab" boolean NOT NULL,
	"since_prev_ms" bigint
);
--> statement-breakpoint
ALTER TABLE "submission_trace" ADD CONSTRAINT "submission_trace_submission_id_fk_submission_id" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;