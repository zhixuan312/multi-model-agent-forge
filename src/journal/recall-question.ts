/**
 * The recall question carried on an `ops_mma_batch.request`, read one way.
 *
 * Two readers of the same rows disagreed about the field. The journal page took
 * `prompt ?? query`, with a comment recording that older rows (pre-harmonization) used
 * `query`; `topFaqs` took `prompt` alone. Same table, same `journal_recall` rows — so a
 * legacy row showed its question in "recent recalls" and was invisible to the FAQ counts,
 * which under-reported exactly the oldest and most-asked questions.
 *
 * One accessor, so the two surfaces cannot drift again. If the legacy rows are ever
 * migrated, the fallback comes out here and both readers change together.
 */
export function recallQuestionOf(request: unknown): string {
  const req = (request ?? {}) as { prompt?: unknown; query?: unknown };
  const raw = typeof req.prompt === 'string' ? req.prompt : typeof req.query === 'string' ? req.query : '';
  return raw.trim();
}
