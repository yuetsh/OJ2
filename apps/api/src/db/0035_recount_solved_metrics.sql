-- 做对题数、中等、困难、一次就对四项按定义重数（判题结算从这一版起也是现数，见
-- services/achievements.ts 的 solvedCounts）。原来逐次 +1，并发判完和重判会多加：
-- 2026-10 的库里 372 人的做对题数比实际多 1–4 道。只改这四个键、只写值变了的行；
-- 已经拿到的成就一个不收回。不含比赛，做对 = ACCEPTED(0) / AST_CHECK_FAILED(10)。
UPDATE "user_stat" AS target
SET "metrics" = target."metrics" || jsonb_build_object(
  'accepted_count', fresh.accepted,
  'mid_ac_count', fresh.mid,
  'hard_ac_count', fresh.hard,
  'first_try_ac_count', fresh.first_try
)
FROM (
  SELECT st."id",
    coalesce(c.accepted, 0) AS accepted,
    coalesce(c.mid, 0) AS mid,
    coalesce(c.hard, 0) AS hard,
    coalesce(f.first_try, 0) AS first_try
  FROM "user_stat" st
  LEFT JOIN (
    SELECT s."user_id",
      count(DISTINCT s."problem_id") FILTER (WHERE s."result" IN (0, 10))::int AS accepted,
      count(DISTINCT s."problem_id") FILTER (WHERE s."result" IN (0, 10) AND p."difficulty" = 'Mid')::int AS mid,
      count(DISTINCT s."problem_id") FILTER (WHERE s."result" IN (0, 10) AND p."difficulty" = 'High')::int AS hard
    FROM "submission" s
    JOIN "problem" p ON p."id" = s."problem_id"
    WHERE s."contest_id" IS NULL
    GROUP BY s."user_id"
  ) c ON c."user_id" = st."user_id"
  LEFT JOIN (
    SELECT first."user_id", count(*) FILTER (WHERE first."result" IN (0, 10))::int AS first_try
    FROM (
      SELECT DISTINCT ON (s."user_id", s."problem_id") s."user_id", s."result"
      FROM "submission" s
      WHERE s."contest_id" IS NULL
      ORDER BY s."user_id", s."problem_id", s."create_time", s."id"
    ) first
    GROUP BY first."user_id"
  ) f ON f."user_id" = st."user_id"
) fresh
WHERE target."id" = fresh."id"
  AND (
    (target."metrics" -> 'accepted_count') IS DISTINCT FROM to_jsonb(fresh.accepted)
    OR (target."metrics" -> 'mid_ac_count') IS DISTINCT FROM to_jsonb(fresh.mid)
    OR (target."metrics" -> 'hard_ac_count') IS DISTINCT FROM to_jsonb(fresh.hard)
    OR (target."metrics" -> 'first_try_ac_count') IS DISTINCT FROM to_jsonb(fresh.first_try)
  );
