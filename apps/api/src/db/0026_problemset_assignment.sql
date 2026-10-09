-- 题单的「截止时间」改成「布置到」：它从来不截止任何东西，只管布置期内藏学生以前的代码（防抄），
-- 见 services/problemset.ts 的 problemSetLockCutoffs。列名 end_time 不改（机房和服务器共库，
-- 改名会让没升级的那边直接报错）；旧值是按旧语义填的（3 个题单，都已过期），清掉。
ALTER TABLE "problemset" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
UPDATE "problemset" SET "end_time" = NULL;--> statement-breakpoint
-- 「状态」和「可见」两道闸合成一个「公开」：草稿等于不公开，归档等于公开（一直都还能进）
UPDATE "problemset" SET "visible" = false WHERE "status" = 'draft';--> statement-breakpoint
UPDATE "problemset" SET "status" = 'active' WHERE "status" <> 'active';--> statement-breakpoint
-- 分数拿掉了，「总分达到 N」的奖章换成「做对 N 道」（线上那几套题每题 10 分，门槛不变）
UPDATE "problemset_badge" SET "condition_type" = 'problem_count', "condition_value" = GREATEST(1, CEIL("condition_value" / 10.0)) WHERE "condition_type" = 'score';
