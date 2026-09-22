-- AI 提示的分级与输出过滤留痕（AI 时代 OJ 设计 2c），字段含义见 schema.ts 的 aiHint。
-- 四列都可空、不带默认值，加列只改目录不重写表；已有的行留 null，表示「分级上线前」。
ALTER TABLE "ai_hint" ADD COLUMN "level" integer;--> statement-breakpoint
ALTER TABLE "ai_hint" ADD COLUMN "filter_attempt" integer;--> statement-breakpoint
ALTER TABLE "ai_hint" ADD COLUMN "filter_blocked" boolean;--> statement-breakpoint
ALTER TABLE "ai_hint" ADD COLUMN "filter_reason" text;