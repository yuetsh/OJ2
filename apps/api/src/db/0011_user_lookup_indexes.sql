CREATE INDEX "user_active_idx" ON "user" USING btree ("is_disabled","last_login" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "user_class_name_idx" ON "user" USING btree ("class_name");