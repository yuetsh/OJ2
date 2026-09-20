-- 把 Java / JavaScript / Golang 从题目的可选语言里摘掉。
--
-- 这三种语言的判题配置和判题镜像里的 JDK / Node / Go 已经一起删了（见
-- judge/languages.ts 和 docker/judge/）。但生产库里有 84 道题的 `languages` 还留着
-- 它们，而题目页的语言下拉就是按这个数组渲染的 —— 不摘掉的话，学生能在那 84 道题上
-- 选 Java 提交，判题时 languageConfigs 查不到就抛 Unsupported judge language，
-- 结果是 SYSTEM_ERROR。**这道迁移是那次删语言的收尾，不能只删代码不清数据。**
--
-- 备份实测：84 道题受影响，其中**没有**任何一道只有这三种语言，所以不会有题目被清空。
-- 保险起见加了 jsonb_array_length > 0 的条件：真要出现这种题，宁可留着不动、让它
-- 在后台显形，也不要把语言清空（题目页会渲染出一个空的语言下拉）。
--
-- 历史提交里那 62 条 Java/JS/Golang 记录**不动**，语言名留在契约里就是为了渲染它们。

UPDATE "problem" p SET "languages" = (
  SELECT jsonb_agg(v ORDER BY ord)
  FROM jsonb_array_elements_text(p."languages") WITH ORDINALITY AS t(v, ord)
  WHERE v NOT IN ('Java', 'JavaScript', 'Golang')
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(p."languages") x(v)
  WHERE x.v IN ('Java', 'JavaScript', 'Golang')
) AND (
  SELECT count(*) FROM jsonb_array_elements_text(p."languages") y(v)
  WHERE y.v NOT IN ('Java', 'JavaScript', 'Golang')
) > 0;--> statement-breakpoint

-- 预制代码和参考答案里对应的条目一并清掉（生产库里是空的，防后台以后写进去）。
UPDATE "problem"
SET "template" = "template" - 'Java' - 'JavaScript' - 'Golang'
WHERE jsonb_exists_any("template", ARRAY['Java', 'JavaScript', 'Golang']);--> statement-breakpoint

UPDATE "problem" p SET "answers" = (
  SELECT COALESCE(jsonb_agg(a ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(p."answers") WITH ORDINALITY AS t(a, ord)
  WHERE a ->> 'language' NOT IN ('Java', 'JavaScript', 'Golang')
)
WHERE p."answers" IS NOT NULL AND jsonb_typeof(p."answers") = 'array' AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(p."answers") x(a)
  WHERE x.a ->> 'language' IN ('Java', 'JavaScript', 'Golang')
);
