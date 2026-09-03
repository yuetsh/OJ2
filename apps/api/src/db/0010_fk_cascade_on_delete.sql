ALTER TABLE "exercise" DROP CONSTRAINT "exercise_tutorial_id_6fd04055_fk_tutorial_id";
--> statement-breakpoint
ALTER TABLE "flowchart_submission" DROP CONSTRAINT "flowchart_submission_problem_id_8551edbf_fk_problem_id";
--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_submission_id_2fdf8a47_fk_submission_id";
--> statement-breakpoint
ALTER TABLE "problem_tags" DROP CONSTRAINT "problem_tags_problem_id_866ecb8d_fk_problem_id";
--> statement-breakpoint
ALTER TABLE "problem_tags" DROP CONSTRAINT "problem_tags_problemtag_id_72d20571_fk_problem_tag_id";
--> statement-breakpoint
ALTER TABLE "problemset_badge" DROP CONSTRAINT "problemset_badge_problemset_id_6cb6c74f_fk_problemset_id";
--> statement-breakpoint
ALTER TABLE "problemset_problem" DROP CONSTRAINT "problemset_problem_problem_id_fff2d686_fk_problem_id";
--> statement-breakpoint
ALTER TABLE "problemset_problem" DROP CONSTRAINT "problemset_problem_problemset_id_350d17fb_fk_problemset_id";
--> statement-breakpoint
ALTER TABLE "problemset_progress" DROP CONSTRAINT "problemset_progress_problemset_id_20a9632e_fk_problemset_id";
--> statement-breakpoint
ALTER TABLE "problemset_submission" DROP CONSTRAINT "problemset_submission_problem_id_5629b105_fk_problem_id";
--> statement-breakpoint
ALTER TABLE "problemset_submission" DROP CONSTRAINT "problemset_submission_problemset_id_85290e17_fk_problemset_id";
--> statement-breakpoint
ALTER TABLE "problemset_submission" DROP CONSTRAINT "problemset_submission_submission_id_78e2b807_fk_submission_id";
--> statement-breakpoint
ALTER TABLE "reaction" DROP CONSTRAINT "reaction_problem_id_a7f3b9f3_fk_problem_id";
--> statement-breakpoint
ALTER TABLE "user_achievement" DROP CONSTRAINT "user_achievement_achievement_id_29db600d_fk_achievement_id";
--> statement-breakpoint
ALTER TABLE "user_badge" DROP CONSTRAINT "user_badge_badge_id_92a983e9_fk_problemset_badge_id";
--> statement-breakpoint
ALTER TABLE "user_profile" DROP CONSTRAINT "user_profile_user_id_8fdce8e2_fk_user_id";
--> statement-breakpoint
ALTER TABLE "user_stat" DROP CONSTRAINT "user_stat_user_id_73337fc0_fk_user_id";
--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_tutorial_id_6fd04055_fk_tutorial_id" FOREIGN KEY ("tutorial_id") REFERENCES "public"."tutorial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flowchart_submission" ADD CONSTRAINT "flowchart_submission_problem_id_8551edbf_fk_problem_id" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_submission_id_2fdf8a47_fk_submission_id" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_tags" ADD CONSTRAINT "problem_tags_problem_id_866ecb8d_fk_problem_id" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_tags" ADD CONSTRAINT "problem_tags_problemtag_id_72d20571_fk_problem_tag_id" FOREIGN KEY ("problemtag_id") REFERENCES "public"."problem_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problemset_badge" ADD CONSTRAINT "problemset_badge_problemset_id_6cb6c74f_fk_problemset_id" FOREIGN KEY ("problemset_id") REFERENCES "public"."problemset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problemset_problem" ADD CONSTRAINT "problemset_problem_problem_id_fff2d686_fk_problem_id" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problemset_problem" ADD CONSTRAINT "problemset_problem_problemset_id_350d17fb_fk_problemset_id" FOREIGN KEY ("problemset_id") REFERENCES "public"."problemset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problemset_progress" ADD CONSTRAINT "problemset_progress_problemset_id_20a9632e_fk_problemset_id" FOREIGN KEY ("problemset_id") REFERENCES "public"."problemset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problemset_submission" ADD CONSTRAINT "problemset_submission_problem_id_5629b105_fk_problem_id" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problemset_submission" ADD CONSTRAINT "problemset_submission_problemset_id_85290e17_fk_problemset_id" FOREIGN KEY ("problemset_id") REFERENCES "public"."problemset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problemset_submission" ADD CONSTRAINT "problemset_submission_submission_id_78e2b807_fk_submission_id" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_problem_id_a7f3b9f3_fk_problem_id" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_achievement_id_29db600d_fk_achievement_id" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badge" ADD CONSTRAINT "user_badge_badge_id_92a983e9_fk_problemset_badge_id" FOREIGN KEY ("badge_id") REFERENCES "public"."problemset_badge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_8fdce8e2_fk_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stat" ADD CONSTRAINT "user_stat_user_id_73337fc0_fk_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;