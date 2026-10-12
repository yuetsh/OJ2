CREATE TABLE "tutorial_problem" (
	"tutorial_id" integer NOT NULL,
	"problem_id" integer NOT NULL,
	"order" integer NOT NULL,
	CONSTRAINT "tutorial_problem_pkey" PRIMARY KEY("tutorial_id","problem_id")
);
--> statement-breakpoint
ALTER TABLE "tutorial" ADD COLUMN "project" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tutorial_problem" ADD CONSTRAINT "tutorial_problem_tutorial_id_fk_tutorial_id" FOREIGN KEY ("tutorial_id") REFERENCES "public"."tutorial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutorial_problem" ADD CONSTRAINT "tutorial_problem_problem_id_fk_problem_id" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 项目原来只写在正文第一段（「**所属项目：项目三 · 智慧农业·蜜橘园**」），抽出来回填。
-- 没写的（9 篇没公开的老 Python 教程）留空，自学目录里归到「其他」
UPDATE "tutorial"
SET "project" = left(trim(substring("content" from '\*\*所属项目[：:]\s*([^*\n]+)\*\*')), 64)
WHERE "content" ~ '\*\*所属项目[：:]';
