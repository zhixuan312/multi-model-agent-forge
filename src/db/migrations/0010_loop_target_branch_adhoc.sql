-- Loops: target branch + one-time (adhoc) jobs.
-- target_branch = the base a loop forks from and opens its PR into (NULL = repo default).
-- cron becomes nullable: a loop with no cron is a one-time job (the scheduler skips it;
-- it only ever runs via Run now). Both still live in the `loop` table.
ALTER TABLE "forge"."loop" ALTER COLUMN "cron" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "forge"."loop" ADD COLUMN "target_branch" text;
