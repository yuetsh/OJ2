-- 流程图老办法（四项打总分）的明细，模型有时给成 {"逻辑正确性": 32, ...} 这样的裸数字，
-- 提交详情读不到 score / max，四项全显示「0 / 0」。2026-10-19 重新评分老提交时线上撞上 4 条
-- （模型换成 deepseek-flash 之后）。裸数字改成 { score, max, comment }，满分按 40 / 30 / 20 / 10；
-- 本来就是对象的项原样不动。新评的由 flowchart/run.ts 的 normalizeCriteria 收好再存。
UPDATE "flowchart_submission" AS target
SET "ai_criteria_details" = fixed.details
FROM (
  SELECT f."id",
    jsonb_object_agg(
      e.key,
      CASE
        WHEN jsonb_typeof(e.value) = 'number' THEN jsonb_build_object(
          'score', e.value,
          'max', CASE e.key
            WHEN '逻辑正确性' THEN 40
            WHEN '完整性' THEN 30
            WHEN '规范性' THEN 20
            WHEN '清晰度' THEN 10
            ELSE 100
          END,
          'comment', ''
        )
        ELSE e.value
      END
    ) AS details
  FROM "flowchart_submission" f, jsonb_each(f."ai_criteria_details") e
  WHERE NOT f."ai_criteria_details" ? 'version'
    AND jsonb_typeof(f."ai_criteria_details") = 'object'
  GROUP BY f."id"
  HAVING bool_or(jsonb_typeof(e.value) = 'number')
) AS fixed
WHERE target."id" = fixed."id";
