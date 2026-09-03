ALTER TABLE "submission" ADD COLUMN "problemset_id" bigint;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_problemset_id_fk_problemset_id" FOREIGN KEY ("problemset_id") REFERENCES "public"."problemset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_problemset_id_idx" ON "submission" USING btree ("problemset_id") WHERE "submission"."problemset_id" is not null;--> statement-breakpoint
-- 历史回填。老提交没有入口信息，唯一可考的是 problemset_submission：它记的是
-- 「这条提交让这道题在这个题单里算完成了」，本来就是刷题单刷出来的那一条，标出来不算冤枉。
-- 覆盖不到的是同一道题在此之前的 WA 和之后的重复 AC —— 那些只能留空，往后新提交才准。
-- 一条提交在多个题单里都记过账时（recordSolvedProblem 会记进所有已加入的题单），
-- 任取其一：来源入口只有一个，但事后已经分不出是哪个了。
UPDATE "submission" SET "problemset_id" = "ps"."problemset_id"
FROM (
  SELECT DISTINCT ON ("submission_id") "submission_id", "problemset_id"
  FROM "problemset_submission" ORDER BY "submission_id", "problemset_id"
) AS "ps"
WHERE "ps"."submission_id" = "submission"."id" AND "submission"."problemset_id" IS NULL;
