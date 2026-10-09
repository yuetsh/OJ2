-- 题单退役的第二步（第一步见 0027）：服务器和机房都已经换上不读写这几列的代码，真正删掉。
-- 破坏性迁移，部署要手工放行（workflow_dispatch 勾 allow_destructive，或 OJ2_ALLOW_DESTRUCTIVE=1）。
DROP TABLE "problemset_submission" CASCADE;--> statement-breakpoint
ALTER TABLE "problemset" DROP COLUMN "difficulty";--> statement-breakpoint
ALTER TABLE "problemset" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "problemset_problem" DROP COLUMN "score";--> statement-breakpoint
ALTER TABLE "problemset_problem" DROP COLUMN "hint";--> statement-breakpoint
ALTER TABLE "problemset_progress" DROP COLUMN "progress_percentage";--> statement-breakpoint
ALTER TABLE "problemset_progress" DROP COLUMN "total_score";
