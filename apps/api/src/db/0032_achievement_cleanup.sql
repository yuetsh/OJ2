-- 成就清单的五处毛病（我的成就重设计，2026-10-13）。只改配置和进度，已经拿到的一个不收回。
--
-- 1. 下架拿不到的：六边形战士要用过 5 种语言，判题机只剩 C / C++ / Python；
--    坚持三天 / 一周按天算，学生跟着课表来，基本拿不到（按周的「周周向上」那一串已经顶上了）。
UPDATE "achievement" SET "visible" = false
WHERE ("metric" = 'languages_used' AND "threshold" = 5) OR "metric" = 'max_ac_streak_days';
--> statement-breakpoint
UPDATE "achievement" SET "description" = 'C、C++、Python 都用过'
WHERE "metric" = 'languages_used' AND "threshold" = 3;
--> statement-breakpoint
-- 2. 稀有度倒挂：错 10 次才做对是黄金、错 20 次反而是白银
UPDATE "achievement" SET "rarity" = 'silver' WHERE "metric" = 'max_wa_before_ac' AND "threshold" = 10;
--> statement-breakpoint
-- 3. 图标撞了：屡败屡战和持之以恒都是火，百发百中和一发入魂是同一个靶子（noto:direct-hit 是 bullseye 的别名）
UPDATE "achievement" SET "rarity" = 'gold', "icon" = 'noto:flexed-biceps'
WHERE "metric" = 'max_wa_before_ac' AND "threshold" = 20;
--> statement-breakpoint
UPDATE "achievement" SET "icon" = 'noto:hundred-points'
WHERE "metric" = 'first_try_ac_count' AND "threshold" = 100;
--> statement-breakpoint
-- 4. 代码行数只算做对的、空行不算：原来交什么都算，贴一大段就是「长篇巨制」
UPDATE "achievement" SET "description" = '做对的代码有 ' || "threshold" || ' 行（空行不算）'
WHERE "metric" = 'max_code_lines';
--> statement-breakpoint
-- 按新口径重算所有人的 max_code_lines（判题结算里的口径见 services/achievements.ts）：
-- 不含比赛，做对 = ACCEPTED(0) / AST_CHECK_FAILED(10)
UPDATE "user_stat" AS target
SET "metrics" = jsonb_set(target."metrics", '{max_code_lines}', to_jsonb(coalesce(fresh.n, 0)))
FROM (
  SELECT st."id", m.n
  FROM "user_stat" st
  LEFT JOIN (
    SELECT s."user_id", max((
      SELECT count(*) FROM regexp_split_to_table(s."code", E'\n') AS line
      WHERE btrim(line, E' \t\r') <> ''
    ))::int AS n
    FROM "submission" s
    WHERE s."contest_id" IS NULL AND s."result" IN (0, 10)
    GROUP BY s."user_id"
  ) m ON m."user_id" = st."user_id"
) fresh
WHERE target."id" = fresh."id"
  AND (target."metrics" -> 'max_code_lines') IS DISTINCT FROM to_jsonb(coalesce(fresh.n, 0));
--> statement-breakpoint
-- 5. 奖杯收藏家数的「已拿到几个」只数上架的（判题结算和 refreshUnlockedCount 同步改了）
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
