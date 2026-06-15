-- Loop run: structured verification + files-changed slots.
-- Previously verification ("verification: not configured") and the file count
-- ("7 file(s) changed") were stuffed into key_changes as fake "changes". They
-- now get their own typed columns; key_changes holds real changes only.
ALTER TABLE "forge"."loop_run" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "forge"."loop_run" ADD COLUMN "files_changed" jsonb;
