-- 一个班一天可以上几节内容不同的课：拿掉一天一行的唯一约束，每次布置一行。
-- 共库的机房站点要一起升级：旧代码布置时 ON CONFLICT (class_name, day) 会因为找不到这条约束报错。
ALTER TABLE "class_lesson" DROP CONSTRAINT "class_lesson_class_day_unique";--> statement-breakpoint
CREATE INDEX "class_lesson_class_day_idx" ON "class_lesson" USING btree ("class_name","day");