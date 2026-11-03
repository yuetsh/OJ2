-- 成就惠及更多学生（2026-11-03）。已经拿到的一个不收回。
--
-- 这学期 375 个交过题的学生，成就数中位数 5 个、三分之一只有 0–2 个。三件事：
--
-- 1. 比赛里的提交也算成就（判题结算同步改了，见 services/achievements.ts 的 solvedCounts）。
--    这里的比赛其实是单班测验，2612 班整个班都在比赛里做题，人均做对 17 道却一个成就也没有；
--    「参加过几场比赛」以前判题时也不更新，只在后台重扫时刷新，所以连「初入赛场」都没拿到。
-- 2. 几条线补上低一档（10 道和 50 道之间、一次就对 1 次和 20 次之间……），外加一条新线
--    「挑战成功」。括号里是这学期学生已经达到的比例。
-- 3. 档多了，「奖杯收藏家」从 15 个提到 20 个，不然人人都有。
--
-- 然后从提交记录把含比赛的指标重数一遍，按新配置给所有达标的人补发（backfilled，不显示日期）。
-- 编译错误次数和按天的连续不重数：前者上线前的历史本来就没有，后者已经下架。

INSERT INTO "achievement" ("name", "description", "icon", "rarity", "hidden", "metric", "operator", "threshold", "visible", "unlock_count", "order", "create_time") VALUES
  ('稳扎稳打', '通过 20 道题目', 'noto:orange-book', 'bronze', false, 'accepted_count', 'gte', 20, true, 0, 2, now()),          -- 44%
  ('初露锋芒', '通过 1 道中等难度题目', 'noto:sunrise-over-mountains', 'bronze', false, 'mid_ac_count', 'gte', 1, true, 0, 6, now()), -- 21%
  ('迎难而上', '挑战成功 1 次', 'noto:puzzle-piece', 'bronze', false, 'challenge_count', 'gte', 1, true, 0, 10, now()),      -- 60%
  ('精益求精', '挑战成功 5 次', 'noto:gem-stone', 'silver', false, 'challenge_count', 'gte', 5, true, 0, 10, now()),         -- 12%
  ('勤学苦练', '累计提交 30 次', 'noto:pencil', 'bronze', false, 'submission_count', 'gte', 30, true, 0, 11, now()),         -- 48%
  ('渐成习惯', '累计 5 天有提交记录', 'noto:spiral-calendar', 'bronze', false, 'active_days', 'gte', 5, true, 0, 15, now()), -- 59%
  ('手感火热', '累计 5 次首次提交即通过', 'noto:glowing-star', 'bronze', true, 'first_try_ac_count', 'gte', 5, true, 0, 25, now()), -- 67%
  ('再试一次', '同一道题失败 3 次后终于通过', 'noto:counterclockwise-arrows-button', 'bronze', true, 'max_wa_before_ac', 'gte', 3, true, 0, 32, now()), -- 54%
  ('一鼓作气', '一天之内通过 5 道题', 'noto:dashing-away', 'bronze', true, 'max_ac_in_one_day', 'gte', 5, true, 0, 34, now()); -- 57%
--> statement-breakpoint
UPDATE "achievement" SET "threshold" = 20, "description" = '解锁 20 个成就（不含白金）'
WHERE "metric" = 'achievement_unlocked_count' AND "threshold" = 15;
--> statement-breakpoint
-- 交过题、还没有 user_stat 的人先建一行（2612 班大多是这样：比赛提交以前根本不进结算）
INSERT INTO "user_stat" ("user_id", "metrics", "update_time")
SELECT DISTINCT s."user_id", '{}'::jsonb, now()
FROM "submission" s
JOIN "user" u ON u."id" = s."user_id"
ON CONFLICT ("user_id") DO NOTHING;
--> statement-breakpoint
-- 按判题结算的口径从提交记录重数（services/achievements.ts）：含比赛；在判的（6/7）不算，
-- 它们判完时结算会自己加；做对 = ACCEPTED(0) / AST_CHECK_FAILED(10)；日历按东八区。
-- 「新做对」= 这道题第一次做对的那条提交。
UPDATE "user_stat" AS target
SET "metrics" = target."metrics" || fresh.metrics, "update_time" = now()
FROM (
  WITH subs AS (
    SELECT s."id", s."user_id", s."problem_id", s."contest_id", s."result", s."language", s."code", s."create_time",
      (s."create_time" AT TIME ZONE 'Asia/Shanghai') AS local, p."difficulty",
      s."result" IN (0, 10) AS ac,
      -- 这道题在这条之前交过几次（同一时刻的不算「之前」，和结算里的 create_time < 一致）
      rank() OVER (PARTITION BY s."user_id", s."problem_id" ORDER BY s."create_time") - 1 AS before
    FROM "submission" s
    JOIN "user" u ON u."id" = s."user_id"
    JOIN "problem" p ON p."id" = s."problem_id"
    WHERE s."result" NOT IN (6, 7)
  ),
  totals AS (
    SELECT "user_id",
      count(DISTINCT "problem_id") FILTER (WHERE ac)::int AS accepted,
      count(DISTINCT "problem_id") FILTER (WHERE ac AND "difficulty" = 'Mid')::int AS mid,
      count(DISTINCT "problem_id") FILTER (WHERE ac AND "difficulty" = 'High')::int AS hard,
      count(*)::int AS submissions,
      count(DISTINCT "contest_id")::int AS contests,
      count(*) FILTER (WHERE extract(hour FROM local) < 5)::int AS midnight,
      count(*) FILTER (WHERE extract(hour FROM local) >= 5 AND extract(hour FROM local) < 7)::int AS early,
      jsonb_agg(DISTINCT "language") AS languages,
      jsonb_agg(DISTINCT to_char(local, 'YYYY-MM-DD')) AS dates
    FROM subs GROUP BY "user_id"
  ),
  first_try AS (
    SELECT "user_id", count(*) FILTER (WHERE ac)::int AS n
    FROM (SELECT DISTINCT ON ("user_id", "problem_id") "user_id", ac FROM subs ORDER BY "user_id", "problem_id", "create_time", "id") f
    GROUP BY "user_id"
  ),
  code_lines AS (
    SELECT "user_id", max((
      SELECT count(*) FROM regexp_split_to_table("code", E'\n') AS line WHERE btrim(line, E' \t\r') <> ''
    ))::int AS n
    FROM subs WHERE ac GROUP BY "user_id"
  ),
  first_ac AS (
    SELECT DISTINCT ON ("user_id", "problem_id") "user_id", "problem_id", local, before
    FROM subs WHERE ac ORDER BY "user_id", "problem_id", "create_time", "id"
  ),
  wa_before AS (
    SELECT "user_id", max(before)::int AS n FROM first_ac GROUP BY "user_id"
  ),
  per_day AS (
    SELECT "user_id", jsonb_object_agg(day, n) AS days, max(n)::int AS best
    FROM (SELECT "user_id", to_char(local, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM first_ac GROUP BY 1, 2) d
    GROUP BY "user_id"
  ),
  weeks AS (
    SELECT DISTINCT "user_id", date_trunc('week', local)::date AS w FROM first_ac
  ),
  runs AS (
    SELECT "user_id", count(*)::int AS len, max(w) AS last_w
    FROM (SELECT "user_id", w, w - (row_number() OVER (PARTITION BY "user_id" ORDER BY w))::int * 7 AS g FROM weeks) i
    GROUP BY "user_id", g
  ),
  streak AS (
    SELECT "user_id", max(len) AS best, (array_agg(len ORDER BY last_w DESC))[1] AS current, max(last_w) AS last_w
    FROM runs GROUP BY "user_id"
  ),
  challenges AS (
    SELECT "user_id", count(*)::int AS n FROM "challenge_success" GROUP BY "user_id"
  )
  SELECT t."user_id",
    jsonb_build_object(
      'accepted_count', t.accepted,
      'mid_ac_count', t.mid,
      'hard_ac_count', t.hard,
      'first_try_ac_count', coalesce(ft.n, 0),
      'submission_count', t.submissions,
      'contest_joined', t.contests,
      'midnight_submissions', t.midnight,
      'early_bird_submissions', t.early,
      '_languages', t.languages,
      'languages_used', jsonb_array_length(t.languages),
      '_active_dates', t.dates,
      'active_days', jsonb_array_length(t.dates),
      'max_code_lines', coalesce(cl.n, 0),
      'max_wa_before_ac', coalesce(wb.n, 0),
      '_ac_per_day', coalesce(pd.days, '{}'::jsonb),
      'max_ac_in_one_day', coalesce(pd.best, 0),
      'challenge_count', coalesce(ch.n, 0)
    ) || CASE WHEN st."user_id" IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'max_ac_week_streak', st.best,
      '_current_ac_week_streak', st.current,
      '_last_ac_week', to_char(st.last_w, 'YYYY-MM-DD')
    ) END AS metrics
  FROM totals t
  LEFT JOIN first_try ft ON ft."user_id" = t."user_id"
  LEFT JOIN code_lines cl ON cl."user_id" = t."user_id"
  LEFT JOIN wa_before wb ON wb."user_id" = t."user_id"
  LEFT JOIN per_day pd ON pd."user_id" = t."user_id"
  LEFT JOIN streak st ON st."user_id" = t."user_id"
  LEFT JOIN challenges ch ON ch."user_id" = t."user_id"
) fresh
WHERE target."user_id" = fresh."user_id";
--> statement-breakpoint
-- 挑战成功了、却一条提交都没有的（不会有，保险）也给个数
UPDATE "user_stat" AS target
SET "metrics" = jsonb_set(target."metrics", '{challenge_count}', to_jsonb(c.n))
FROM (SELECT "user_id", count(*)::int AS n FROM "challenge_success" GROUP BY "user_id") c
WHERE target."user_id" = c."user_id" AND (target."metrics" -> 'challenge_count') IS DISTINCT FROM to_jsonb(c.n);
--> statement-breakpoint
-- 补发：上架的、非元成就，达标没发的都发（口径同 rescanAchievement：backfilled、待通知）
INSERT INTO "user_achievement" ("user_id", "achievement_id", "unlock_time", "backfilled", "notified")
SELECT st."user_id", a."id", now(), true, false
FROM "user_stat" st
JOIN "achievement" a ON a."visible" AND a."metric" <> 'achievement_unlocked_count'
WHERE jsonb_typeof(st."metrics" -> a."metric") = 'number'
  AND CASE WHEN a."operator" = 'gte' THEN (st."metrics" ->> a."metric")::numeric >= a."threshold"
           ELSE (st."metrics" ->> a."metric")::numeric <= a."threshold" END
ON CONFLICT ("user_id", "achievement_id") DO NOTHING;
--> statement-breakpoint
-- 已解锁数（上架的非白金）重数，口径同 refreshUnlockedCount
UPDATE "user_stat" AS target
SET "metrics" = jsonb_set(target."metrics", '{achievement_unlocked_count}', to_jsonb(fresh.value))
FROM (
  SELECT s."id", coalesce(c.value, 0) AS value
  FROM "user_stat" s
  LEFT JOIN (
    SELECT ua."user_id", count(*)::int AS value
    FROM "user_achievement" ua
    JOIN "achievement" a ON a."id" = ua."achievement_id"
    WHERE a."rarity" <> 'platinum' AND a."visible"
    GROUP BY ua."user_id"
  ) c ON c."user_id" = s."user_id"
) fresh
WHERE target."id" = fresh."id"
  AND (target."metrics" -> 'achievement_unlocked_count') IS DISTINCT FROM to_jsonb(fresh.value);
--> statement-breakpoint
-- 第二轮：元成就（奖杯收藏家）
INSERT INTO "user_achievement" ("user_id", "achievement_id", "unlock_time", "backfilled", "notified")
SELECT st."user_id", a."id", now(), true, false
FROM "user_stat" st
JOIN "achievement" a ON a."visible" AND a."metric" = 'achievement_unlocked_count'
WHERE jsonb_typeof(st."metrics" -> a."metric") = 'number'
  AND CASE WHEN a."operator" = 'gte' THEN (st."metrics" ->> a."metric")::numeric >= a."threshold"
           ELSE (st."metrics" ->> a."metric")::numeric <= a."threshold" END
ON CONFLICT ("user_id", "achievement_id") DO NOTHING;
--> statement-breakpoint
UPDATE "achievement" AS a
SET "unlock_count" = coalesce(c.n, 0)
FROM (SELECT "achievement_id", count(*)::int AS n FROM "user_achievement" GROUP BY "achievement_id") c
WHERE c."achievement_id" = a."id" AND a."unlock_count" IS DISTINCT FROM c.n;
