-- 0024: Migrate all data to v5.4 shapes (development mode — no backward compat)
--
-- 1. project.phase: 'frozen' → 'build', 'done' → 'learn'
-- 2. ops_mma_batch.result: old envelope → new { task, output, execution, metrics, raw, error }
-- 3. ops_mma_batch.request: old field names → new field names

-- Phase migration
UPDATE forge.project SET phase = 'build' WHERE phase = 'frozen';
UPDATE forge.project SET phase = 'learn' WHERE phase = 'done';

-- Result envelope migration: transform old shape to new shape
-- Only touch rows that have the old shape (structuredReport at top level)
UPDATE forge.ops_mma_batch
SET result = jsonb_build_object(
  'task', jsonb_build_object(
    'taskId', COALESCE(result->'results'->0->>'taskId', id::text),
    'type', route,
    'status', CASE
      WHEN result->'error'->>'kind' = 'not_applicable' THEN 'done'
      WHEN result->'error'->>'code' IS NOT NULL THEN 'failed'
      WHEN result->>'status' IS NOT NULL THEN result->>'status'
      ELSE 'done'
    END
  ),
  'output', jsonb_build_object(
    'summary', COALESCE(
      result->'structuredReport'->'summary',
      result->'results'->0->'report'->'implementer',
      '""'::jsonb
    ),
    'filesChanged', COALESCE(result->'structuredReport'->'filesChanged', '[]'::jsonb),
    'contextBlockId', result->'contextBlockId'
  ),
  'execution', jsonb_build_object(
    'sessions', jsonb_build_object(
      'implementer', COALESCE(result->'results'->0->'sessions'->'implementer'->>'sessionId', null),
      'reviewer', COALESCE(result->'results'->0->'sessions'->'reviewer'->>'sessionId', null)
    ),
    'worktree', null
  ),
  'metrics', jsonb_build_object(
    'totalDurationMs', COALESCE((result->'taskTimings'->>'wallClockMs')::numeric, (result->'batchTimings'->>'wallClockMs')::numeric, 0),
    'totalCostUsd', COALESCE((result->'costSummary'->>'totalActualCostUSD')::numeric, 0),
    'totalUsage', jsonb_build_object(
      'inputTokens', COALESCE((result->>'totalInputTokens')::int, 0),
      'outputTokens', COALESCE((result->>'totalOutputTokens')::int, 0),
      'cachedReadTokens', 0,
      'cachedNonReadTokens', 0
    ),
    'savedVsMainCostUsd', result->'costSummary'->'totalCostDeltaVsMainUSD'
  ),
  'raw', jsonb_build_object(
    'implementer', COALESCE(result->'results'->0->'report'->>'implementer', null),
    'reviewer', COALESCE(result->'results'->0->'report'->>'reviewer', null)
  ),
  'error', CASE
    WHEN result->'error'->>'kind' = 'not_applicable' THEN null
    WHEN result->'error'->>'code' IS NOT NULL THEN result->'error'
    WHEN result->'error'->>'message' IS NOT NULL THEN result->'error'
    ELSE null
  END
)
WHERE result IS NOT NULL
  AND result ? 'structuredReport';

-- Also migrate error-only results (no structuredReport)
UPDATE forge.ops_mma_batch
SET result = jsonb_build_object(
  'task', jsonb_build_object('taskId', id::text, 'type', route, 'status', 'failed'),
  'output', jsonb_build_object('summary', null, 'filesChanged', '[]'::jsonb, 'contextBlockId', null),
  'execution', jsonb_build_object('sessions', jsonb_build_object('implementer', null, 'reviewer', null), 'worktree', null),
  'metrics', jsonb_build_object('totalDurationMs', 0, 'totalCostUsd', 0, 'totalUsage', jsonb_build_object('inputTokens', 0, 'outputTokens', 0, 'cachedReadTokens', 0, 'cachedNonReadTokens', 0), 'savedVsMainCostUsd', null),
  'raw', jsonb_build_object('implementer', null, 'reviewer', null),
  'error', result->'error'
)
WHERE result IS NOT NULL
  AND NOT result ? 'structuredReport'
  AND NOT result ? 'task';

-- Request body migration: rename old fields to new schema
-- filePaths → target.paths
UPDATE forge.ops_mma_batch
SET request = (request - 'filePaths') || jsonb_build_object('target', jsonb_build_object('paths', request->'filePaths'))
WHERE request IS NOT NULL AND request ? 'filePaths';

-- taskDescriptors → tasks
UPDATE forge.ops_mma_batch
SET request = (request - 'taskDescriptors') || jsonb_build_object('tasks', request->'taskDescriptors')
WHERE request IS NOT NULL AND request ? 'taskDescriptors';

-- perTaskReviewPolicy → reviewPolicy (take first value)
UPDATE forge.ops_mma_batch
SET request = (request - 'perTaskReviewPolicy') || jsonb_build_object('reviewPolicy', COALESCE(
  (SELECT value FROM jsonb_each_text(request->'perTaskReviewPolicy') LIMIT 1),
  'reviewed'
))
WHERE request IS NOT NULL AND request ? 'perTaskReviewPolicy';

-- question → prompt (investigate)
UPDATE forge.ops_mma_batch
SET request = (request - 'question') || jsonb_build_object('prompt', request->'question')
WHERE request IS NOT NULL AND request ? 'question' AND route = 'investigate';

-- query → prompt (journal_recall)
UPDATE forge.ops_mma_batch
SET request = (request - 'query') || jsonb_build_object('prompt', request->'query')
WHERE request IS NOT NULL AND request ? 'query' AND route = 'journal_recall';

-- researchQuestion + background → prompt (research)
UPDATE forge.ops_mma_batch
SET request = (request - 'researchQuestion' - 'background') || jsonb_build_object(
  'prompt', COALESCE(request->>'researchQuestion', '') || E'\n\nBackground: ' || COALESCE(request->>'background', '')
)
WHERE request IS NOT NULL AND request ? 'researchQuestion' AND route = 'research';
