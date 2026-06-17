-- Regroup every table under a 5-group `<group>_<entity>` naming scheme so the
-- table list reads cleanly: team_* (accounts + team config), workspace_* (repos),
-- project_* (the whole SDLC: explore→spec→plan→execute→review), loop_* (recurring
-- maintenance), ops_* (cross-cutting engine + audit records). Aggregate roots
-- `project` and `loop` stay bare. Pure renames — data, indexes, and FKs ride along
-- (FKs reference table OIDs, not names). The Drizzle exports are unchanged.
ALTER TABLE "forge"."iam_member" RENAME TO "team_member";--> statement-breakpoint
ALTER TABLE "forge"."iam_identity" RENAME TO "team_identity";--> statement-breakpoint
ALTER TABLE "forge"."iam_session" RENAME TO "team_session";--> statement-breakpoint
ALTER TABLE "forge"."settings_connection" RENAME TO "team_connection";--> statement-breakpoint
ALTER TABLE "forge"."settings_secret" RENAME TO "team_secret";--> statement-breakpoint
ALTER TABLE "forge"."repo" RENAME TO "workspace_repo";--> statement-breakpoint
ALTER TABLE "forge"."stage" RENAME TO "project_stage";--> statement-breakpoint
ALTER TABLE "forge"."component" RENAME TO "project_component";--> statement-breakpoint
ALTER TABLE "forge"."component_section" RENAME TO "project_component_section";--> statement-breakpoint
ALTER TABLE "forge"."qa_message" RENAME TO "project_qa_message";--> statement-breakpoint
ALTER TABLE "forge"."artifact" RENAME TO "project_artifact";--> statement-breakpoint
ALTER TABLE "forge"."audit_pass" RENAME TO "project_audit_pass";--> statement-breakpoint
ALTER TABLE "forge"."learning_candidate" RENAME TO "project_learning_candidate";--> statement-breakpoint
ALTER TABLE "forge"."plan_task" RENAME TO "project_plan_task";--> statement-breakpoint
ALTER TABLE "forge"."export" RENAME TO "project_export";--> statement-breakpoint
ALTER TABLE "forge"."attachment" RENAME TO "project_attachment";--> statement-breakpoint
ALTER TABLE "forge"."exploration_task" RENAME TO "project_exploration_task";--> statement-breakpoint
ALTER TABLE "forge"."mma_batch" RENAME TO "ops_mma_batch";--> statement-breakpoint
ALTER TABLE "forge"."action_log" RENAME TO "ops_action_log";
