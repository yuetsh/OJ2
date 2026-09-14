-- 提交列表「题号」「用户名」两个筛选的索引，用法和实测数据见 schema.ts 里两条索引的注释。
--
-- pg_trgm 是 contrib 模块，要先装扩展，drizzle-kit generate 不会替你写这一句。
-- 官方 postgres:16-alpine 镜像自带 contrib，且 pg_trgm 是 trusted 扩展（PG 13 起），
-- 库 owner 就能装。换成不带 contrib 的 Postgres 时这里会失败、部署停在迁移这步。
-- CREATE EXTENSION 可以在事务里执行，不需要 no-transaction 标记。
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "submission_public_problem_time_idx" ON "submission" USING btree ("problem_id","create_time","id") WHERE "submission"."contest_id" is null;--> statement-breakpoint
CREATE INDEX "submission_public_username_trgm_idx" ON "submission" USING gin ("username" gin_trgm_ops) WHERE "submission"."contest_id" is null;
