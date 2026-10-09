-- 题单里不再用的几列 / 一张表，分两步退役（机房和服务器共用这个库、不一定同时升级）：
--
-- 这一步（0027）：代码已经不读不写它们了，这里只给还非空的几列补上默认值，让新代码
-- 插行时不用再填。没升级的那边照旧读写，互不影响。meta/0027_snapshot.json 里它们已经不在了。
--
-- 下一步（两个站点都换上新代码以后）：另起一条 custom 迁移真正删掉，要手工放行破坏性迁移：
--   DROP TABLE "problemset_submission" CASCADE;
--   ALTER TABLE "problemset" DROP COLUMN "difficulty";
--   ALTER TABLE "problemset" DROP COLUMN "status";
--   ALTER TABLE "problemset_problem" DROP COLUMN "score";
--   ALTER TABLE "problemset_problem" DROP COLUMN "hint";
--   ALTER TABLE "problemset_progress" DROP COLUMN "progress_percentage";
--   ALTER TABLE "problemset_progress" DROP COLUMN "total_score";
ALTER TABLE "problemset" ALTER COLUMN "difficulty" SET DEFAULT 'Easy';--> statement-breakpoint
ALTER TABLE "problemset" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "problemset_problem" ALTER COLUMN "score" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "problemset_progress" ALTER COLUMN "progress_percentage" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "problemset_progress" ALTER COLUMN "total_score" SET DEFAULT 0;
