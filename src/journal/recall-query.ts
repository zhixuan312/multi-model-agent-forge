/**
 * What counts as an askable recall query.
 *
 * The bounds lived in two places that had to agree: `app/api/journal/recall/route.ts` (two
 * `if` statements and their 400 messages) and `RecallTab` (a `canSubmit` expression and a
 * second copy inside `run()`). The client's copy decides whether the button is enabled; the
 * server's decides whether the request is honoured. When two sides of a submit each hold
 * their own copy of the rule, the failure is silent in one direction and confusing in the
 * other — the same asymmetry the loop-activity filter had against its own `?status=`
 * validator.
 *
 * The client also has to SHOW the rule. The composer displayed `{length}/4000` and nothing
 * about the minimum, so a five-character question left the Recall button disabled with a
 * counter that looked perfectly happy.
 */
export const RECALL_QUERY_MIN = 10;
export const RECALL_QUERY_MAX = 4000;

export type RecallQueryCheck =
  | { ok: true; query: string }
  | { ok: false; message: string };

/** Validate a raw query, trimming first — both callers work on the trimmed text. */
export function checkRecallQuery(raw: string): RecallQueryCheck {
  const query = raw.trim();
  if (query.length < RECALL_QUERY_MIN) {
    return { ok: false, message: `Query must be at least ${RECALL_QUERY_MIN} characters.` };
  }
  if (query.length > RECALL_QUERY_MAX) {
    return { ok: false, message: `Query must be at most ${RECALL_QUERY_MAX} characters.` };
  }
  return { ok: true, query };
}
