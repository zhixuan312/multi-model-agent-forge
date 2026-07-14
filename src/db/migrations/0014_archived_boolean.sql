ALTER TABLE "forge"."project" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "forge"."project" SET "archived" = true WHERE "archived_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "forge"."project" DROP COLUMN "archived_at";
