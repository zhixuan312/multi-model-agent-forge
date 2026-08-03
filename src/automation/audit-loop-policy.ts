/**
 * The ONE audit-loop policy, shared by all three audit-loops (spec/finalize,
 * plan/validate, review/review). `AUDIT_PASS_CAP` is the single named cap (spec §3
 * rationale-for-5); no audit-loop may hardcode the number (AC13). `auditLoopStep`
 * is the auto/best-practice step; the manual early-exit (advance after ≥1 pass) is
 * layered in `allowedActions.addManualExtras`, NOT here — so this stays mode-free.
 */
import { isParked } from '@/automation/attempt-status';
export const AUDIT_PASS_CAP = 5;

interface AttemptLike { status: string }
export interface AuditPassLike {
  passNo?: number;
  status: string; // 'clean' | 'revised' | ...
  audit?: { attempts: AttemptLike[] };
  fix?: { attempts: AttemptLike[] };
}

export type AuditStep =
  | { kind: 'dispatch_audit'; passNo: number }
  | { kind: 'apply_findings'; passNo: number }
  | { kind: 'advance' }
  | { kind: 'wait' };

/**
 * Is the latest pass's audit or fix attempt one the loop must not act over? True while
 * an attempt is `running` (in flight), and also once one is `cancelled` (engine 5.16):
 * a deliberate stop is terminal, so re-dispatching the same pass would undo it. Both
 * suppress the loop's next step — auto WAITs, and the manual affordances stay hidden
 * until a human takes over. A `failed` attempt is NOT in flight: it retries.
 */
export function auditInFlight(passes: AuditPassLike[]): boolean {
  const last = passes[passes.length - 1];
  if (!last) return false;
  const a = last.audit?.attempts ?? [];
  const f = last.fix?.attempts ?? [];
  return isParked(a[a.length - 1]) || isParked(f[f.length - 1]);
}

/**
 * The best-practice (auto) step within an audit-loop. Applies the last pass's fix
 * BEFORE advancing, even at the cap — so review matches spec/plan (fixes line 191:
 * never advance while a `revised` pass still has no fix applied).
 */
export function auditLoopStep(passes: AuditPassLike[]): AuditStep {
  if (auditInFlight(passes)) return { kind: 'wait' };
  const last = passes[passes.length - 1];
  if (!last) return { kind: 'dispatch_audit', passNo: 1 };
  if (last.status === 'revised') {
    if (!last.fix || last.fix.attempts.length === 0) {
      return { kind: 'apply_findings', passNo: last.passNo ?? passes.length };
    }
    if (passes.length < AUDIT_PASS_CAP) return { kind: 'dispatch_audit', passNo: passes.length + 1 };
  }
  return { kind: 'advance' };
}
