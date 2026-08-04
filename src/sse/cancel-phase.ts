/**
 * The phase string a cancelling batch reports, in a module both sides can import.
 *
 * `PollManager` publishes it (`task.progress.headline` for task-backed batches,
 * `dispatch.progress.phase` for handler-backed ones) precisely so no consumer needs a new
 * event type to render "stopping…". But the publisher lives in `poll-manager.ts`, which
 * reaches the database — so the browser could not import the constant and had to either
 * hard-code the word or, as it did, render nothing at all.
 *
 * One string, one definition, readable from the client: the UI matches on the same value
 * the server sends rather than a copy that can drift.
 */
export const CANCELLING_HEADLINE = 'cancelling';
