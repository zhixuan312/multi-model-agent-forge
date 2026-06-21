-- Drop the legacy per-tier model-config tables. The combined Models page
-- configures models through the engine's POST /configure-provider, which
-- persists to ~/.mma/config.json (the single source of truth) + the engine's
-- keystore — Forge never writes these tables. `agent_tier` was only ever seeded
-- with empty rows and `provider` was never populated, so both are dead. The
-- main-tier model now comes from config.json (server-client + resolveMainTier).
-- Drop agent_tier first (its provider_id FK references provider).
DROP TABLE IF EXISTS "forge"."agent_tier";--> statement-breakpoint
DROP TABLE IF EXISTS "forge"."provider";
