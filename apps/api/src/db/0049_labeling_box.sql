-- 「数据标注」加第四种类型「框选」（2026-11-17）：条目多一列答案框、作答多一列第一次交的框。
-- 只加列（有默认值或可空），不动已有数据。设计见 docs/specs/2026-11-17-data-labeling-lab-design.md 3.6 节。
ALTER TABLE "labeling_answer" ADD COLUMN "first_boxes" jsonb;--> statement-breakpoint
ALTER TABLE "labeling_item" ADD COLUMN "boxes" jsonb DEFAULT '[]'::jsonb NOT NULL;