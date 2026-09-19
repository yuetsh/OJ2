-- AI 提示两段式的诊断结果（AI 时代 OJ 设计 2b），字段含义见 schema.ts 的 aiHint。
-- 两列都可空、不带默认值，加列只改目录不重写表。
ALTER TABLE "ai_hint" ADD COLUMN "diagnosis" jsonb;--> statement-breakpoint
ALTER TABLE "ai_hint" ADD COLUMN "diagnosis_error" text;