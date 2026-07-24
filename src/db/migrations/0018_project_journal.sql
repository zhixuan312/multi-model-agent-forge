-- Hand-authored project journal staging table and ordered index.

CREATE TABLE "forge"."project_journal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "heading" text NOT NULL,
  "body" text NOT NULL,
  "type" text NOT NULL,
  "topic" text NOT NULL,
  "status" text NOT NULL,
  "seq" integer NOT NULL,
  "recorded_node_id" text,
  "recorded_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_journal_project_id_fk"
    FOREIGN KEY ("project_id")
    REFERENCES "forge"."project"("id")
    ON DELETE cascade
    ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "project_journal_project_seq_idx"
  ON "forge"."project_journal"
  USING btree ("project_id", "seq");
