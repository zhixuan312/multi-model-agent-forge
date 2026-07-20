-- Component governance is a CODE catalog (registry + variant-meta) plus a static
-- conformance checker; there is no persisted lock/knob state. Drop the now-unused
-- singleton settings table (its unique index is dropped with it).
DROP TABLE IF EXISTS "forge"."component_governance";
