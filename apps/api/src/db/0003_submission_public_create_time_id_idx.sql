-- 把公开提交列表的部分索引从 (create_time) 换成 (create_time, id)。
--
-- 为什么要加 id：列表分页改用「offset → 游标」两步查询（见 routes/submission.ts 的
-- paginateSubmissionRows）。create_time 由 `new Date().toISOString()` 生成，只有毫秒
-- 精度，同毫秒的两条提交分不出先后，游标回查时上一页末行会重复出现在下一页页首。
-- 加上 id 让排序变成全序，两步走同一个顺序，翻页结果精确。
--
-- 两列都是 ASC：查询 `ORDER BY create_time DESC, id DESC` 靠 Index Only Scan Backward
-- 反着扫这条索引。写成 (create_time DESC, id DESC) 反而用不上——ORDER BY 的 DESC 默认
-- NULLS FIRST，索引的 DESC 默认 NULLS LAST，规划器认为出不了序，会退化成全量排序。
--
-- 锁窗口：这里是普通 CREATE INDEX（不是 CONCURRENTLY），建索引期间**阻塞写入**。
-- 生产快照 12.3 万行 / 171MB 上实测不到 1 秒，且部署本来就在停机窗口里做，够用。
-- 真要热更再拆成两条带 `oj2:no-transaction` 的迁移。
--
-- 先 DROP 再 CREATE 是安全的：两条语句在同一个事务里（migrate.ts 一条迁移一个事务），
-- 中途失败会整体回滚，不会留下「老的没了、新的没建成」的中间态。

DROP INDEX "submission_public_create_time_idx";--> statement-breakpoint
CREATE INDEX "submission_public_create_time_id_idx" ON "submission" USING btree ("create_time","id") WHERE "submission"."contest_id" is null;