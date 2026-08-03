import type { ProjectPhase, StageKind } from '@/db/enums';
import { STAGE_LABEL } from '@/projects/stage-lifecycle';

/**
 * The derived "what should I do next?" for a project. A pure function of the
 * project's gate state — the heart of the control tower. Blockers (a human gate,
 * an open audit finding) always win over plain stage progress.
 */
export type NextActionTone = 'attention' | 'normal' | 'info' | 'done';

export interface NextAction {
  label: string;
  tone: NextActionTone;
}

export interface NextActionInput {
  phase: ProjectPhase;
  currentStage: StageKind | null;
  /** Spec components with no approval yet. (There is no AI-gate flag in details to read.) */
  awaitingHuman: number;
  /** Audited stages whose LATEST pass came back `revised` — 0, 1 or 2. Not a finding count. */
  auditsNeedingFix: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * What "continue" means at each stage — the stage's own name, from `STAGE_LABEL`.
 *
 * The design branch used to be `currentStage === 'spec' ? 'Continue spec' : 'Continue
 * exploration'`, and design spans THREE stages — exploration, spec and plan
 * (`STAGE_PHASE` in `details/write.ts`). A project sitting on the plan stage was told to
 * continue its exploration: the control tower's one job is to say what to do next, and for
 * a third of the design phase it pointed two stages backwards.
 *
 * Derived rather than listed, so it is total by construction AND says what the stepper
 * says. Writing the six out here produced a second set of stage nouns — "Continue
 * exploration" beside a stepper chip reading "Explore" — which is what `STAGE_LABEL` exists
 * to prevent, and what `single-source-maps` caught the moment the map was written.
 */
const continueLabel = (stage: StageKind): string => `Continue ${STAGE_LABEL[stage]}`;

export function deriveNextAction(i: NextActionInput): NextAction {
  // Blockers first — a decision the human owes the flow.
  if (i.awaitingHuman > 0) {
    // `need`/`needs` agrees with the count — one section "need you" was the copy that
    // shipped, and its test asserted the broken string.
    const verb = i.awaitingHuman === 1 ? 'needs' : 'need';
    return { label: `Review — ${plural(i.awaitingHuman, 'section')} ${verb} you`, tone: 'attention' };
  }
  if (i.auditsNeedingFix > 0) {
    // Not `${n} audit findings`: this counts STAGES, capped at two, so a spec pass with
    // twelve findings read "Resolve 1 audit finding". Details stores no finding count,
    // so the honest label carries no number at all.
    return { label: 'Resolve audit findings', tone: 'attention' };
  }
  // Otherwise, the stage-driven next step.
  switch (i.phase) {
    case 'completed':
      return { label: 'Completed', tone: 'done' };
    case 'learn':
      return { label: 'Learn', tone: 'done' };
    case 'build':
      return { label: 'Build running', tone: 'info' };
    case 'design':
      // `?? 'exploration'` for a project with no stage yet — the state a freshly created
      // project is in before its first dispatch.
      return { label: continueLabel(i.currentStage ?? 'exploration'), tone: 'normal' };
  }
}
