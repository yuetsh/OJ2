-- 「数据分析」后台能拖动排序（2026-11-12）：lab 加 order 列，已有的按建的先后排成 1、2、3 …
ALTER TABLE "lab" ADD COLUMN "order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "lab" SET "order" = r.n FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "lab") r WHERE "lab"."id" = r."id";
