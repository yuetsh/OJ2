-- 删掉旧 Django 后端遗留的 7 张表。2026-08-26 确认旧后端不再使用、也不再作为回滚路径。
--
-- 执行前提：目标库上**没有任何 Django 进程还在跑**。旧后端一旦还活着，
-- 掉的是它的 session 表和 migration 记录，会直接打崩线上。
--
-- 已核实（在生产快照上）：
--   * 没有任何 OJ2 保留的表引用这 7 张表，它们之间只有 3 条内部外键，删除是自洽的；
--   * 5 个相关序列（auth_group_id_seq 等）都由各自的表 owned，随 DROP TABLE 一并消失，
--     不需要单独 DROP SEQUENCE；
--   * 表里没有需要保留的数据：auth_permission 136 行、django_content_type 34 行、
--     django_migrations 91 行、django_session 1 行，其余为空——全是 Django 自身的元数据。
--
-- 按外键依赖顺序删，不用 CASCADE：这样万一将来真有别的东西引用了，会直接报错而不是被悄悄级联掉。
DROP TABLE IF EXISTS auth_group_permissions;--> statement-breakpoint
DROP TABLE IF EXISTS auth_permission;--> statement-breakpoint
DROP TABLE IF EXISTS auth_group;--> statement-breakpoint
DROP TABLE IF EXISTS django_content_type;--> statement-breakpoint
DROP TABLE IF EXISTS django_dramatiq_task;--> statement-breakpoint
DROP TABLE IF EXISTS django_migrations;--> statement-breakpoint
DROP TABLE IF EXISTS django_session;
