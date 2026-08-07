-- 阶段 1 本地题目样本导入脚本。
--
-- /tmp/problems.csv 从生产库 problem 表导出，只取 contest_id IS NULL、按 id
-- 排序的前 20 道题，避免为本地列表验收额外复制比赛数据。
-- /tmp/tags.csv 从生产库 problem_tag 表导出。两份 CSV 均不包含用户表数据，
-- 仅保留在本机并由 .gitignore 排除；devadmin 只是满足外键的本地占位用户。

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO "user" (id, password, username, admin_type, problem_permission, open_api, is_disabled, session_keys, raw_password)
VALUES (1, 'unusable', 'devadmin', 'Super Admin', 'All', false, false, '[]'::jsonb, 'devonly')
ON CONFLICT (id) DO NOTHING;

\copy problem_tag FROM '/tmp/tags.csv' WITH CSV HEADER
\copy problem FROM '/tmp/problems.csv' WITH CSV HEADER

COMMIT;
