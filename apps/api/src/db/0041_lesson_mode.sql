-- 这节课做什么：写代码 / 画流程图 / 先画再写。以前布置的都是写代码；带 DEFAULT，没升级的旧代码照样能布置
ALTER TABLE "class_lesson" ADD COLUMN "mode" text DEFAULT 'code' NOT NULL;
