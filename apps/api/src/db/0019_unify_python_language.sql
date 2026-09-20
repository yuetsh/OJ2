-- 语言值统一成 `Python`：库里原来有 `Python3`（104527 条提交）和 `Python2`（3 条，
-- 全是 2022 年的），界面上两个都显示成「Python」，内部却是两个值。判题沙箱早就只剩
-- 一个 Python 了，这里把落库的值也并成一个。
--
-- 语言名不是判题状态码那种「判题机也认得的编码」—— 它只是我们自己的键（语言配置是
-- 整个对象发给判题机的），所以可以改。但它确实是**落库的值**，改完再回滚到旧版后端，
-- 旧代码查 languageConfigs["Python"] 会查不到 → 所有 Python 提交变 SYSTEM_ERROR。
-- 为此后端保留了 Python2/Python3 → Python 的别名（见 judge/languages.ts），
-- 新旧代码读哪一种数据都不会炸。
--
-- 涉及的四张表是全量扫备份确认过的（submission / problem / user_stat /
-- options_sysoptions）。options_sysoptions 里那行 `languages` 是 Django 时代的判题
-- 配置，OJ2 只读 website_* 几个键，不碰它，所以这里**故意不动**。

-- ① 提交记录。12 万条里 8 成是 Python，走一次全表 UPDATE。
UPDATE "submission" SET "language" = 'Python'
WHERE "language" IN ('Python2', 'Python3');--> statement-breakpoint

-- ② 题目的可选语言。用 WITH ORDINALITY 保住原来的顺序 —— 题目页的语言下拉和默认
--    选中项就是按这个数组的顺序来的，打乱了学生打开题目看到的默认语言会变。
UPDATE "problem" p SET "languages" = (
  SELECT COALESCE(jsonb_agg(
    CASE WHEN v IN ('Python2', 'Python3') THEN 'Python' ELSE v END ORDER BY ord
  ), '[]'::jsonb)
  FROM jsonb_array_elements_text(p."languages") WITH ORDINALITY AS t(v, ord)
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(p."languages") x(v)
  WHERE x.v IN ('Python2', 'Python3')
);--> statement-breakpoint

-- ③ 预制代码，键是语言名（75 道题有 Python3 的模板）。
UPDATE "problem"
SET "template" = ("template" - 'Python3') || jsonb_build_object('Python', "template" -> 'Python3')
WHERE jsonb_exists("template", 'Python3');--> statement-breakpoint

-- ④ AST 代码规则，键就是语言名（15 道题）。
UPDATE "problem"
SET "ast_rules" = ("ast_rules" - 'Python3') || jsonb_build_object('Python', "ast_rules" -> 'Python3')
WHERE "ast_rules" IS NOT NULL AND jsonb_exists("ast_rules", 'Python3');--> statement-breakpoint

-- ⑤ 参考答案，形如 [{"language": "...", "code": "..."}]（257 条 Python3 答案）。
UPDATE "problem" p SET "answers" = (
  SELECT jsonb_agg(
    CASE WHEN a ->> 'language' IN ('Python2', 'Python3')
      THEN jsonb_set(a, '{language}', '"Python"')
      ELSE a END ORDER BY ord
  )
  FROM jsonb_array_elements(p."answers") WITH ORDINALITY AS t(a, ord)
)
WHERE p."answers" IS NOT NULL AND jsonb_typeof(p."answers") = 'array' AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(p."answers") x(a)
  WHERE x.a ->> 'language' IN ('Python2', 'Python3')
);--> statement-breakpoint

-- ⑥ 成就指标里的「用过哪些语言」（1235 个用户）。_languages 去重之后重算
--    languages_used —— 同时用过 Python2 和 Python3 的那 3 个用户，数字会从 n 掉到
--    n-1，这是**对的**：那本来就是同一种语言。已经发出去的成就不回收。
WITH mapped AS (
  SELECT s."id", jsonb_agg(d.v ORDER BY d.ord) AS arr
  FROM "user_stat" s, LATERAL (
    SELECT DISTINCT ON (val) val AS v, ord FROM (
      SELECT CASE WHEN e IN ('Python2', 'Python3') THEN 'Python' ELSE e END AS val, ord
      FROM jsonb_array_elements_text(s."metrics" -> '_languages') WITH ORDINALITY AS t(e, ord)
    ) m ORDER BY val, ord
  ) d
  WHERE jsonb_typeof(s."metrics" -> '_languages') = 'array' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(s."metrics" -> '_languages') x(e)
    WHERE x.e IN ('Python2', 'Python3')
  )
  GROUP BY s."id"
)
UPDATE "user_stat" s SET "metrics" = jsonb_set(
  jsonb_set(s."metrics", '{_languages}', mapped.arr),
  '{languages_used}', to_jsonb(jsonb_array_length(mapped.arr))
)
FROM mapped WHERE mapped."id" = s."id";
