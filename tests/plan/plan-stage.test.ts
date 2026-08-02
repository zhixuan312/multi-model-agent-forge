import { describe, it, expect } from 'vitest';
import { groupTasksIntoPhases } from '@/plan/plan-core';
import { SEVERITY_ORDER, compareSeverity, isBlockingSeverity } from '@/lib/severity';

/**
 * Two of the three cases here used to assert nothing about this codebase.
 *
 * - "PlanAuditFinding includes evidence and suggestion fields" built an object literal in
 *   the test and asserted it carried the fields just written into it. `PlanAuditFinding`
 *   is a real exported interface (`src/build/plan-types.ts`) that was never referenced.
 * - "sorts findings by severity order" declared `const SEVERITY_ORDER = [...]` INSIDE the
 *   test and sorted a local array with a local comparator — a test of `Array.prototype.sort`.
 *   The real `SEVERITY_ORDER` is exported and drives `FindingsGrid`'s display order.
 *
 * Worse, chasing the real constant found the SAME rule written out four times across the
 * codebase (see `@/lib/severity`). These now exercise the shared module.
 */
describe('groupTasksIntoPhases', () => {
  it('groups multiple tasks into a single implementation phase', () => {
    const tasks = [
      { id: 't1', num: 1, title: 'Task 1', body: '', files: [], dependsOn: [], targetRepo: 'r' },
      { id: 't2', num: 2, title: 'Task 2', body: '', files: [], dependsOn: [], targetRepo: 'r' },
      { id: 't3', num: 3, title: 'Task 3', body: '', files: [], dependsOn: [], targetRepo: 'r' },
    ];
    const phases = groupTasksIntoPhases(tasks);
    expect(phases).toHaveLength(1);
    expect(phases[0].tasks).toHaveLength(3);
  });
});

describe('severity ordering (the shared constant, not a local copy)', () => {
  it('is most-severe-first', () => {
    expect([...SEVERITY_ORDER]).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('compareSeverity sorts a findings list most-severe-first', () => {
    const findings = [
      { severity: 'medium' }, { severity: 'critical' }, { severity: 'low' }, { severity: 'high' },
    ];
    const sorted = [...findings].sort((a, b) => compareSeverity(a.severity, b.severity));
    expect(sorted.map((f) => f.severity)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('sorts an UNRECOGNISED severity last, never first', () => {
    // A typo must not dominate the list: an unknown severity is not evidence of urgency.
    const sorted = ['low', 'frobnicated', 'critical'].sort(compareSeverity);
    expect(sorted).toEqual(['critical', 'low', 'frobnicated']);
  });
});

describe('isBlockingSeverity — the clean/revised rule', () => {
  it('critical and high block; medium and low are advisory', () => {
    expect(isBlockingSeverity('critical')).toBe(true);
    expect(isBlockingSeverity('high')).toBe(true);
    expect(isBlockingSeverity('medium')).toBe(false);
    expect(isBlockingSeverity('low')).toBe(false);
  });

  it('is case-insensitive — the review path reads a free-text weight off the envelope', () => {
    expect(isBlockingSeverity('CRITICAL')).toBe(true);
    expect(isBlockingSeverity('High')).toBe(true);
  });

  it('an unknown severity does NOT block', () => {
    // Fail-open here is deliberate: an unrecognised weight must not silently gate a pass
    // as revised forever. The parse layer drops unknown severities before this runs.
    expect(isBlockingSeverity('')).toBe(false);
    expect(isBlockingSeverity('frobnicated')).toBe(false);
  });
});
