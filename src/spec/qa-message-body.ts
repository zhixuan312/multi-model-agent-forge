/**
 * Q&A chat message body limits — one definition for the spec-component and plan-task
 * message routes.
 *
 * Both routes accepted `bodyMd` of ANY length straight into a `text` column. The brief
 * path already carries this lesson: `briefSchema` declares a 100k ceiling, and
 * `details-actions.ts` records that nothing applied it until a fix went in ("a brief of
 * unbounded length … straight into a `text` column"). A chat message is the same shape of
 * input from the same untrusted place, and it also fans out over SSE to every connected
 * client of that project.
 *
 * 32k is generous for a message a human types or pastes and small enough that one post
 * cannot flood the stream.
 */
export const QA_MESSAGE_MAX_CHARS = 32_000;

/** Narrow an untrusted `bodyMd` to a trimmed string, or null when it is unusable. */
export function parseQaMessageBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > QA_MESSAGE_MAX_CHARS) return null;
  return trimmed;
}
