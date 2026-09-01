CREATE TABLE "tutorial_progress" (
	"user_id" integer NOT NULL,
	"tutorial_id" integer NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"total_seconds" integer DEFAULT 0 NOT NULL,
	"first_viewed_at" timestamp with time zone NOT NULL,
	"last_viewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tutorial_progress_pkey" PRIMARY KEY("user_id","tutorial_id")
);
--> statement-breakpoint
ALTER TABLE "tutorial_progress" ADD CONSTRAINT "tutorial_progress_user_id_fk_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutorial_progress" ADD CONSTRAINT "tutorial_progress_tutorial_id_fk_tutorial_id" FOREIGN KEY ("tutorial_id") REFERENCES "public"."tutorial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tutorial_progress_tutorial_id_idx" ON "tutorial_progress" USING btree ("tutorial_id");