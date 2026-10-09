-- 排在删列（0028）之后、而不是之前：0028 可能已经在线上执行过，created_at 比它小的迁移
-- 会被执行器当成「已经跑过」永远跳过。这条只碰进度和奖章表，和删列互不影响。
--
-- 0026 把「总分达到 N」的奖章换成了「做对 N 道」，但只改了条件、没按新条件补发：
-- 每题不到 10 分的题单里，做对的题数早就够了、原来的总分却不够的人没拿到（快照里玩家国度
-- 做对 7 道的人没有「成分复杂」），页面上还显示「再做对 1 道」。这里按现在的条件只补不收：
-- 拿到过的不收回（把学生已经拿到的奖章收走不合适），漏发的补上。
INSERT INTO "user_badge" ("user_id", "badge_id", "earned_time")
SELECT g."user_id", b."id", now()
FROM "problemset_progress" g
JOIN "problemset_badge" b ON b."problemset_id" = g."problemset_id"
WHERE (
  b."condition_type" = 'problem_count'
  AND (SELECT count(*) FROM jsonb_object_keys(g."progress_detail")) >= b."condition_value"
) OR (
  b."condition_type" = 'all_problems'
  AND g."total_problems_count" > 0
  AND g."completed_problems_count" = g."total_problems_count"
)
ON CONFLICT ("badge_id", "user_id") DO NOTHING;
