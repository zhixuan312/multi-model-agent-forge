/**
 * Guide rail navigation — the LIGHTWEIGHT projection of the Guide's table of
 * contents (id · part · title only).
 *
 * The Sidebar renders the Guide's section list on every authed route, so it
 * cannot import `@/content/direction-sections` (~55 KB of body prose) without
 * dragging the whole manual into every page's bundle. This module is the
 * deliberate duplicate of just the nav fields, hand-maintained and drift-locked
 * by `tests/content/guide-nav.test.ts`, which asserts it matches
 * `DIRECTION_SECTIONS.map(({ id, part, title }) => …)` exactly.
 *
 * It imports NOTHING — adding an import of the content modules here would defeat
 * its whole purpose and break `scripts/check-direction-import-boundary.ts`.
 */
export type GuidePartId = 'product' | 'engine' | 'backend' | 'forge' | 'telemetry';

/** The five movements, in rail order. Mirrors `PARTS` in `direction-sections.ts`. */
export const GUIDE_PARTS: readonly { part: GuidePartId; title: string }[] = [
  { part: 'product', title: 'The product' },
  { part: 'engine', title: 'The engine · shared by both modes' },
  { part: 'backend', title: 'The backend · how the engine runs' },
  { part: 'forge', title: 'Forge · the team app' },
  { part: 'telemetry', title: 'Telemetry · proof surface' },
];

export interface GuideNavSection {
  id: string;
  part: GuidePartId;
  title: string;
}

/** Every Guide section in canonical source order; `[0]` is the landing section. */
export const GUIDE_NAV_SECTIONS: readonly GuideNavSection[] = [
  { id: 'insight-and-bet', part: 'product', title: 'The insight' },
  { id: 'principles', part: 'product', title: 'The global principles' },
  { id: 'reviewed-lifecycle', part: 'product', title: 'The AI Development Life Cycle (AIDLC)' },
  { id: 'one-engine-two-modes', part: 'product', title: 'One engine, two modes' },
  { id: 'what-we-wont-do', part: 'product', title: 'What we won\'t do & where we\'re going' },
  { id: 'routing-two-slots', part: 'engine', title: 'Routing & the three layers' },
  { id: 'tool-audit', part: 'engine', title: 'Audit' },
  { id: 'tool-review', part: 'engine', title: 'Review' },
  { id: 'tool-debug', part: 'engine', title: 'Debug' },
  { id: 'tool-investigate', part: 'engine', title: 'Investigate' },
  { id: 'tool-research', part: 'engine', title: 'Research' },
  { id: 'tool-spec', part: 'engine', title: 'Spec' },
  { id: 'tool-plan', part: 'engine', title: 'Plan' },
  { id: 'tool-delegate', part: 'engine', title: 'Delegate' },
  { id: 'tool-execute-plan', part: 'engine', title: 'Execute plan' },
  { id: 'tool-journal-recall', part: 'engine', title: 'Journal recall' },
  { id: 'tool-journal-record', part: 'engine', title: 'Journal record' },
  { id: 'provider-runtimes', part: 'backend', title: 'Built on the providers’ own runtimes' },
  { id: 'cache-tokens', part: 'backend', title: 'Optimizing cache-token usage' },
  { id: 'bounded-execution', part: 'backend', title: 'Bounded execution' },
  { id: 'tool-context-block', part: 'backend', title: 'Register context block' },
  { id: 'tool-retry', part: 'backend', title: 'Retry' },
  { id: 'tool-task-poll', part: 'backend', title: 'Poll task' },
  { id: 'forge-role', part: 'forge', title: 'Forge — the team mode' },
  { id: 'forge-spine', part: 'forge', title: 'The gated SDLC spine' },
  { id: 'forge-automation', part: 'forge', title: 'Automation gates at design' },
  { id: 'forge-collaboration', part: 'forge', title: 'Roles, gates & shared knowledge' },
  { id: 'telemetry-role', part: 'telemetry', title: 'Telemetry — the proof surface' },
  { id: 'telemetry-evidence-model', part: 'telemetry', title: 'One evidence model' },
  { id: 'telemetry-honest-null', part: 'telemetry', title: 'Honest-null discipline' },
  { id: 'telemetry-public-gated', part: 'telemetry', title: 'Public aggregate, gated detail' },
];

/** The section the bare `/settings/guide` index lands on. */
export const GUIDE_FIRST_SECTION_ID = GUIDE_NAV_SECTIONS[0].id;
