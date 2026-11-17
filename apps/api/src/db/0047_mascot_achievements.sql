-- 「小鲸鱼」一组成就（2026-11-17）：拿看板娘的互动记录（mascot_event）做的，图标是她的样子（icon = mascot:<姿势名>）。
--
-- 指标键都以 mascot_ 开头，平时在碰她之后结算（services/mascot-achievements.ts）。
-- 这一组**不算进「奖杯收藏家」**（已解锁数照旧只数别的），也不算进本班「成就最多」。
-- 门槛按 11-03～11-17 的生产数据定的，括号里是 259 个碰过她的学生里已经达到的人数。
-- 玩法类的（惹毛、甩晕……）是隐藏成就，拿到才知道。

INSERT INTO "achievement" ("name", "description", "icon", "rarity", "hidden", "metric", "operator", "threshold", "visible", "unlock_count", "order", "create_time") VALUES
  ('混熟了', '有 3 天来找过她', 'mascot:greet', 'bronze', false, 'mascot_days', 'gte', 3, true, 0, 40, now()),                 -- 54
  ('老熟人', '有 10 天来找过她', 'mascot:wave', 'silver', false, 'mascot_days', 'gte', 10, true, 0, 40, now()),                -- 0（最多 7 天）
  ('形影不离', '有 30 天来找过她', 'mascot:heart', 'gold', false, 'mascot_days', 'gte', 30, true, 0, 40, now()),
  ('投喂员', '喂她 1 条小鱼干', 'mascot:eat', 'bronze', false, 'mascot_fed', 'gte', 1, true, 0, 41, now()),                   -- 85
  ('饲养员', '喂她 10 条小鱼干', 'mascot:snack', 'silver', false, 'mascot_fed', 'gte', 10, true, 0, 41, now()),               -- 6
  ('首席饲养员', '喂她 30 条小鱼干', 'mascot:party', 'gold', false, 'mascot_fed', 'gte', 30, true, 0, 41, now()),
  ('她点的菜', '做对她挑的「每天一道」', 'mascot:cooking', 'bronze', false, 'mascot_daily', 'gte', 1, true, 0, 42, now()),     -- 4
  ('照单全收', '做对 5 次她挑的「每天一道」', 'mascot:thumbs', 'silver', false, 'mascot_daily', 'gte', 5, true, 0, 42, now()),
  ('有求必应', '做对 15 次她挑的「每天一道」', 'mascot:trophy', 'gold', false, 'mascot_daily', 'gte', 15, true, 0, 42, now()),
  ('鲸鱼观察员', '见过她 30 种样子', 'mascot:curious', 'bronze', false, 'mascot_poses', 'gte', 30, true, 0, 43, now()),        -- 约 80
  ('鲸鱼研究员', '见过她 60 种样子', 'mascot:review', 'silver', false, 'mascot_poses', 'gte', 60, true, 0, 43, now()),         -- 0（最多 48）
  ('鲸鱼百科全书', '她的 91 种样子全都见过', 'mascot:achievement', 'gold', false, 'mascot_poses', 'gte', 91, true, 0, 43, now()),
  ('听她唠叨', '听她说过 50 句不一样的话', 'mascot:wink', 'bronze', false, 'mascot_lines', 'gte', 50, true, 0, 44, now()),    -- 100
  ('知心朋友', '听她说过 150 句不一样的话', 'mascot:touched', 'silver', false, 'mascot_lines', 'gte', 150, true, 0, 44, now()), -- 约 15
  ('她的树洞', '听她说过 300 句不一样的话', 'mascot:calm', 'gold', false, 'mascot_lines', 'gte', 300, true, 0, 44, now()),     -- 0（最多 266）
  ('新衣服', '第一次给她换衣服', 'mascot:pajama', 'bronze', false, 'mascot_outfits', 'gte', 1, true, 0, 45, now()),            -- 102
  ('时装周', '12 身衣服都给她穿过', 'mascot:festival-christmas', 'gold', false, 'mascot_outfits', 'gte', 12, true, 0, 45, now()),
  ('有问必答', '回答她问的一个问题', 'mascot:ponder', 'bronze', false, 'mascot_answers', 'gte', 1, true, 0, 46, now()),        -- 20
  ('无话不谈', '她问的 9 个问题都答过', 'mascot:idea', 'gold', false, 'mascot_answers', 'gte', 9, true, 0, 46, now()),
  ('被抓包', '被她指出过 3 种不同的错', 'mascot:smirk', 'bronze', false, 'mascot_mistakes', 'gte', 3, true, 0, 47, now()),      -- 127
  ('错误收藏家', '被她指出过 8 种不同的错', 'mascot:debug', 'silver', false, 'mascot_mistakes', 'gte', 8, true, 0, 47, now()),
  -- 隐藏的
  ('惹毛了', '连点到她背过身去生闷气', 'mascot:fuming', 'bronze', true, 'mascot_sulk', 'gte', 1, true, 0, 48, now()),            -- 71
  ('哄好了', '她生闷气时摸摸头把她哄好', 'mascot:blush', 'bronze', true, 'mascot_forgive_pat', 'gte', 1, true, 0, 49, now()),     -- 40
  ('一条鱼的事', '她生闷气时喂一条小鱼干哄好', 'mascot:happy', 'silver', true, 'mascot_forgive_fish', 'gte', 1, true, 0, 49, now()), -- 9
  ('叫醒服务', '把打盹的她点醒', 'mascot:sleepy', 'silver', true, 'mascot_wake', 'gte', 1, true, 0, 50, now()),                  -- 7
  ('喂鱼叫早', '她睡着时喂一条小鱼干把她喂醒', 'mascot:nap-desk', 'silver', true, 'mascot_feed_wake', 'gte', 1, true, 0, 50, now()), -- 0
  ('捉迷藏', '她缩在屏幕边上时被你找到', 'mascot:sneak', 'bronze', true, 'mascot_peek_found', 'gte', 1, true, 0, 51, now()),      -- 31
  ('鲸鱼保龄球', '把她甩出去撞晕', 'mascot:dizzy', 'bronze', true, 'mascot_fling', 'gte', 1, true, 0, 52, now()),                -- 78
  ('全中', '把她甩晕 50 次', 'mascot:bold', 'silver', true, 'mascot_fling', 'gte', 50, true, 0, 52, now()),                       -- 10
  ('摇摇乐', '拎着她摇到晕', 'mascot:omg', 'bronze', true, 'mascot_shake', 'gte', 1, true, 0, 53, now()),                         -- 90
  ('痒痒挠', '用鼠标蹭着给她挠痒', 'mascot:giggle', 'bronze', true, 'mascot_tickle', 'gte', 1, true, 0, 54, now()),               -- 32
  ('揪尾巴', '拎着她的尾巴拖', 'mascot:tail-grabbed', 'bronze', true, 'mascot_tail', 'gte', 1, true, 0, 55, now()),              -- 112
  ('吃撑了', '一口气喂到她说吃饱了', 'mascot:stretch', 'silver', true, 'mascot_full', 'gte', 1, true, 0, 56, now()),                 -- 11
  ('不死心', '被她嫌烦 30 次还在点', 'mascot:angry', 'silver', true, 'mascot_overclick', 'gte', 30, true, 0, 57, now()),          -- 约 10
  ('过节啦', '节日当天给她穿上那天的节日装', 'mascot:festival-spring', 'silver', true, 'mascot_festival', 'gte', 1, true, 0, 58, now());
--> statement-breakpoint
UPDATE "achievement" SET "description" = '解锁 20 个成就（不含白金和小鲸鱼）'
WHERE "metric" = 'achievement_unlocked_count' AND "description" = '解锁 20 个成就（不含白金）';
--> statement-breakpoint
-- 碰过她、还没有 user_stat 的人先建一行
INSERT INTO "user_stat" ("user_id", "metrics", "update_time")
SELECT DISTINCT e."user_id", '{}'::jsonb, now()
FROM "mascot_event" e
JOIN "user" u ON u."id" = e."user_id"
ON CONFLICT ("user_id") DO NOTHING;
--> statement-breakpoint
-- 按 services/mascot-achievements.ts 的口径从记录数一遍（这里是当时的快照）。
-- 「过节啦」记 0：衣柜 11-09 上线，那之后还没过过节
UPDATE "user_stat" AS target
SET "metrics" = target."metrics" || fresh.metrics, "update_time" = now()
FROM (
  WITH daily AS (
    SELECT d."user_id", count(*)::int AS n FROM (
      SELECT DISTINCT ON ("user_id", ("created_at" AT TIME ZONE 'Asia/Shanghai')::date)
        "user_id", "action"::int AS problem, ("created_at" AT TIME ZONE 'Asia/Shanghai')::date AS day
      FROM "mascot_event" WHERE "kind" = 'daily'
      ORDER BY "user_id", ("created_at" AT TIME ZONE 'Asia/Shanghai')::date, "created_at"
    ) d
    WHERE EXISTS (
      SELECT 1 FROM "submission" s
      WHERE s."user_id" = d."user_id" AND s."problem_id" = d.problem AND s."result" IN (0, 10)
        AND (s."create_time" AT TIME ZONE 'Asia/Shanghai')::date = d.day
    )
    GROUP BY d."user_id"
  )
  SELECT e."user_id", jsonb_build_object(
    'mascot_days', count(DISTINCT (e."created_at" AT TIME ZONE 'Asia/Shanghai')::date)
      FILTER (WHERE e."kind" IN ('open', 'action', 'pat', 'overclick', 'move', 'play', 'answer', 'feed', 'dress')),
    'mascot_fed', count(*) FILTER (WHERE e."kind" = 'feed'),
    'mascot_daily', coalesce(max(daily.n), 0),
    'mascot_poses', count(DISTINCT e."action") FILTER (WHERE e."kind" = 'pose'),
    'mascot_lines', count(DISTINCT e."line") FILTER (WHERE e."kind" IN ('open', 'speak', 'pat', 'overclick', 'play', 'feed')),
    'mascot_outfits', count(DISTINCT e."action") FILTER (WHERE e."kind" = 'dress' AND e."action" <> 'none'),
    'mascot_answers', count(DISTINCT e."situation") FILTER (WHERE e."kind" = 'answer' AND e."situation" LIKE 'ask.%'),
    'mascot_mistakes', count(DISTINCT CASE e."situation"
        WHEN 'problem.chinesePuncts' THEN 'problem.chinesePunct'
        WHEN 'lint.wrongLangPython' THEN 'lint.wrongLangC'
        WHEN 'lint.undefinedNameGuess' THEN 'lint.undefinedName'
        WHEN 'lint.extraBracket' THEN 'lint.unclosedBracket'
        ELSE e."situation" END)
      FILTER (WHERE e."kind" IN ('speak', 'open') AND (e."situation" LIKE 'lint.%' OR e."situation" LIKE 'problem.chinesePunct%')),
    'mascot_sulk', count(*) FILTER (WHERE e."kind" = 'open' AND e."situation" = 'sulk'),
    'mascot_forgive_pat', count(*) FILTER (WHERE e."kind" = 'pat' AND e."situation" = 'sulk.forgive'),
    'mascot_forgive_fish', count(*) FILTER (WHERE e."kind" = 'feed' AND e."situation" = 'feed.forgive'),
    'mascot_wake', count(*) FILTER (WHERE e."kind" = 'open' AND e."situation" = 'wake'),
    'mascot_feed_wake', count(*) FILTER (WHERE e."kind" = 'feed' AND e."situation" = 'feed.wake'),
    'mascot_peek_found', count(*) FILTER (WHERE e."kind" = 'open' AND e."situation" = 'peek.found'),
    'mascot_fling', count(*) FILTER (WHERE e."kind" = 'play' AND e."action" = 'fling'),
    'mascot_shake', count(*) FILTER (WHERE e."kind" = 'play' AND e."action" = 'shake'),
    'mascot_tickle', count(*) FILTER (WHERE e."kind" = 'play' AND e."action" = 'tickle'),
    'mascot_tail', count(*) FILTER (WHERE e."kind" = 'pose' AND e."action" = 'tail-grabbed'),
    'mascot_full', count(*) FILTER (WHERE e."kind" = 'open' AND e."situation" = 'feed.full'),
    'mascot_overclick', count(*) FILTER (WHERE e."kind" = 'overclick'),
    'mascot_festival', 0
  ) AS metrics
  FROM "mascot_event" e
  JOIN "user" u ON u."id" = e."user_id"
  LEFT JOIN daily ON daily."user_id" = e."user_id"
  GROUP BY e."user_id"
) fresh
WHERE target."user_id" = fresh."user_id";
--> statement-breakpoint
-- 补发达标的（口径同 0044：backfilled、待通知 —— 下次换页时一个个弹出来）
INSERT INTO "user_achievement" ("user_id", "achievement_id", "unlock_time", "backfilled", "notified")
SELECT st."user_id", a."id", now(), true, false
FROM "user_stat" st
JOIN "achievement" a ON a."visible" AND left(a."metric", 7) = 'mascot_'
WHERE jsonb_typeof(st."metrics" -> a."metric") = 'number'
  AND (st."metrics" ->> a."metric")::numeric >= a."threshold"
ON CONFLICT ("user_id", "achievement_id") DO NOTHING;
--> statement-breakpoint
UPDATE "achievement" AS a
SET "unlock_count" = c.n
FROM (SELECT "achievement_id", count(*)::int AS n FROM "user_achievement" GROUP BY "achievement_id") c
WHERE c."achievement_id" = a."id" AND left(a."metric", 7) = 'mascot_' AND a."unlock_count" IS DISTINCT FROM c.n;
