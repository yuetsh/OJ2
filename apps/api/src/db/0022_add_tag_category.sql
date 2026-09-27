-- 标签分「知识点 / 主题」两类，前台题目列表按两组显示，含义见契约 tagCategorySchema。
-- 带常量默认值的加列只改目录不重写表；新标签默认算知识点、且分类「未确认」，
-- 后台标签管理把未确认的排在最前面，等老师点一下归类。
ALTER TABLE "problem_tag" ADD COLUMN "category" text DEFAULT 'knowledge' NOT NULL;--> statement-breakpoint
ALTER TABLE "problem_tag" ADD COLUMN "category_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- 存量标签的归类：按名字挑出主题类标签，其余留在知识点。按 lower(name) 匹配
-- （和唯一索引 problem_tag_name_ci_unique 同一口径），库里没有的名字空转即可。
-- 必会题、技能队、力扣是题集 / 来源而不是知识点，也归主题。
UPDATE "problem_tag" SET "category" = 'theme' WHERE lower("name") IN (
  '弱智吧', '二次元', '狐妖小红娘', '第五人格', '农药', '哈利波特', '九大学科', '原',
  '职一第一深情', '异兽', '反诈', '三角洲', '火影', '神秘复苏', 'blue archive',
  '空洞骑士', '周杰伦', 'lol', '奥特曼', '无畏契约', '图书馆', '物联网',
  '必会题', '技能队', '力扣'
);--> statement-breakpoint
-- 上面这版归类已经人工过目，存量标签一律算确认过；之后新建的才进「待归类」
UPDATE "problem_tag" SET "category_confirmed" = true;
