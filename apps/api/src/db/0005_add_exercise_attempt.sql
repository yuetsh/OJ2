CREATE TABLE "exercise_attempt" (
	"user_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"wrong_attempts" integer DEFAULT 0 NOT NULL,
	"solved" boolean DEFAULT false NOT NULL,
	"attempts_to_solve" integer,
	"last_wrong_answer" text,
	"first_attempt_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"solved_at" timestamp with time zone,
	CONSTRAINT "exercise_attempt_pkey" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
ALTER TABLE "exercise_attempt" ADD CONSTRAINT "exercise_attempt_user_id_fk_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempt" ADD CONSTRAINT "exercise_attempt_exercise_id_fk_exercise_id" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_attempt_exercise_id_idx" ON "exercise_attempt" USING btree ("exercise_id");