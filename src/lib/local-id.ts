/**
 * A unique id for something that exists only in the browser — an optimistic message awaiting
 * its server id, a React key for a locally-appended row.
 *
 * Both stage clients minted these as `tmp-${Date.now()}`, which collides for two sends
 * inside the same millisecond. That id is a React key AND the handle used to reconcile the
 * optimistic row with the server's reply, so a collision reconciles the wrong message.
 * PlanStageClient already had a monotonic counter for its OTHER local ids and used the
 * timestamp here anyway — two id schemes in one file for the same job.
 *
 * Never persisted: a row keyed with one is replaced by the server's id on success, or
 * removed on failure.
 */
let counter = 0;

export function localId(prefix = 'local'): string {
  counter += 1;
  return `${prefix}-${counter}`;
}
