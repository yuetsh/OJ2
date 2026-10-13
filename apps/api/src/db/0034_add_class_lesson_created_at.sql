ALTER TABLE "class_lesson" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
-- 加这一列之前布置的：只剩最后一次改的时刻，拿它当布置时刻
UPDATE "class_lesson" SET "created_at" = "updated_at";--> statement-breakpoint
ALTER TABLE "class_lesson" ALTER COLUMN "created_at" SET NOT NULL;
