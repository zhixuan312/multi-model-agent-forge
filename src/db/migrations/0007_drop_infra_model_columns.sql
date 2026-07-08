-- The MMA response envelope never carried the implementer/reviewer model IDs or
-- tier, so these columns were always NULL and their infra-breakdown columns have
-- been removed from the UI. Drop the dead columns (data preserved elsewhere).
ALTER TABLE forge.ops_mma_batch DROP COLUMN IF EXISTS implementer_model;
ALTER TABLE forge.ops_mma_batch DROP COLUMN IF EXISTS reviewer_model;
ALTER TABLE forge.ops_mma_batch DROP COLUMN IF EXISTS implementer_tier;
