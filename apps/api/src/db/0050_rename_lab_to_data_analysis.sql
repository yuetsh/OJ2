-- 「数据分析」从 lab 改名 data_analysis（2026-11-17）：「实验室」现在下面有「数据标注」「数据分析」两块，
-- lab 这个词留给整个实验室；单说 analysis 又会和「智能分析」（ai_analysis）撞，所以叫 data_analysis。
-- 表、列、序列、约束、索引一起改，只改名不动数据。RENAME 不在迁移闸门的拦截名单里（不掉数据）。
-- 部署时迁移先跑、新 api 后起：中间几秒旧 api 找不到 lab 表，数据分析会报错，起来就好。
ALTER TABLE "lab" RENAME TO "data_analysis";--> statement-breakpoint
ALTER TABLE "lab_step" RENAME TO "data_analysis_step";--> statement-breakpoint
ALTER TABLE "lab_asset" RENAME TO "data_analysis_asset";--> statement-breakpoint
ALTER TABLE "lab_progress" RENAME TO "data_analysis_progress";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME COLUMN "lab_id" TO "data_analysis_id";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME COLUMN "lab_id" TO "data_analysis_id";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME COLUMN "lab_id" TO "data_analysis_id";--> statement-breakpoint
ALTER SEQUENCE "lab_id_seq" RENAME TO "data_analysis_id_seq";--> statement-breakpoint
ALTER SEQUENCE "lab_step_id_seq" RENAME TO "data_analysis_step_id_seq";--> statement-breakpoint
ALTER SEQUENCE "lab_asset_id_seq" RENAME TO "data_analysis_asset_id_seq";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_created_by_id_fk_user_id" TO "data_analysis_created_by_id_fk_user_id";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME CONSTRAINT "lab_asset_lab_id_fk_lab_id" TO "data_analysis_asset_data_analysis_id_fk_data_analysis_id";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_lab_id_fk_lab_id" TO "data_analysis_progress_data_analysis_id_fk_data_analysis_id";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_step_id_fk_lab_step_id" TO "data_analysis_progress_step_id_fk_data_analysis_step_id";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_user_id_fk_user_id" TO "data_analysis_progress_user_id_fk_user_id";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_lab_id_fk_lab_id" TO "data_analysis_step_data_analysis_id_fk_data_analysis_id";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_pkey" TO "data_analysis_pkey";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME CONSTRAINT "lab_asset_pkey" TO "data_analysis_asset_pkey";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_pkey" TO "data_analysis_progress_pkey";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_pkey" TO "data_analysis_step_pkey";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME CONSTRAINT "lab_asset_lab_id_name_key" TO "data_analysis_asset_data_analysis_id_name_key";--> statement-breakpoint
ALTER INDEX "lab_progress_lab_id_idx" RENAME TO "data_analysis_progress_data_analysis_id_idx";--> statement-breakpoint
ALTER INDEX "lab_step_lab_id_idx" RENAME TO "data_analysis_step_data_analysis_id_idx";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_created_at_not_null" TO "data_analysis_created_at_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_created_by_id_not_null" TO "data_analysis_created_by_id_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_description_not_null" TO "data_analysis_description_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_id_not_null" TO "data_analysis_id_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_is_public_not_null" TO "data_analysis_is_public_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_order_not_null" TO "data_analysis_order_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_title_not_null" TO "data_analysis_title_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis" RENAME CONSTRAINT "lab_updated_at_not_null" TO "data_analysis_updated_at_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME CONSTRAINT "lab_asset_created_at_not_null" TO "data_analysis_asset_created_at_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME CONSTRAINT "lab_asset_data_not_null" TO "data_analysis_asset_data_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME CONSTRAINT "lab_asset_id_not_null" TO "data_analysis_asset_id_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME CONSTRAINT "lab_asset_lab_id_not_null" TO "data_analysis_asset_data_analysis_id_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME CONSTRAINT "lab_asset_name_not_null" TO "data_analysis_asset_name_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_asset" RENAME CONSTRAINT "lab_asset_size_not_null" TO "data_analysis_asset_size_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_code_not_null" TO "data_analysis_progress_code_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_lab_id_not_null" TO "data_analysis_progress_data_analysis_id_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_runs_not_null" TO "data_analysis_progress_runs_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_step_id_not_null" TO "data_analysis_progress_step_id_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_updated_at_not_null" TO "data_analysis_progress_updated_at_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_progress" RENAME CONSTRAINT "lab_progress_user_id_not_null" TO "data_analysis_progress_user_id_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_check_kind_not_null" TO "data_analysis_step_check_kind_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_check_script_not_null" TO "data_analysis_step_check_script_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_compare_vars_not_null" TO "data_analysis_step_compare_vars_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_description_not_null" TO "data_analysis_step_description_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_id_not_null" TO "data_analysis_step_id_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_kind_not_null" TO "data_analysis_step_kind_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_lab_id_not_null" TO "data_analysis_step_data_analysis_id_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_order_not_null" TO "data_analysis_step_order_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_reference_code_not_null" TO "data_analysis_step_reference_code_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_starter_code_not_null" TO "data_analysis_step_starter_code_not_null";--> statement-breakpoint
ALTER TABLE "data_analysis_step" RENAME CONSTRAINT "lab_step_title_not_null" TO "data_analysis_step_title_not_null";
