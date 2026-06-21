-- Bring the loop-group root into the `<group>_<entity>` scheme too: the loop
-- definition table `loop` → `loop_def` (it pairs with `loop_run`, the execution).
-- Pure rename; data, indexes, and the loop_run FK ride along.
ALTER TABLE "forge"."loop" RENAME TO "loop_def";
