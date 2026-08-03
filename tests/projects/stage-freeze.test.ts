// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  stagePermissionsFrom, allStagesLocked, allStagesOpen, permKeyFor,
  type StageProgress,
} from '@/projects/stage-freeze';
import { STAGE_KIND } from '@/db/enums';

const at = (over: Partial<StageProgress> = {}): StageProgress => ({
  executeStarted: false, executeDone: false, reviewDone: false, journalDone: false, ...over,
});

/**
 * The rule was embedded in the DB-bound `getStagePermissions`, so the governance
 * StageFlowDemo — which has no project — wrote it out a second time, six lock-reason
 * strings included, under a comment claiming it matched. These cases pin the rule itself,
 * for both callers.
 */
describe('stage freeze rule', () => {
  it('leaves every stage editable before execution starts', () => {
    const p = stagePermissionsFrom(at());
    for (const k of ['explore', 'spec', 'plan', 'execute', 'review', 'journal'] as const) {
      expect(p[k].canMutate, k).toBe(true);
      expect(p[k].reason, k).toBeUndefined();
    }
  });

  it('freezes the three design stages the moment execution starts, and says why', () => {
    const p = stagePermissionsFrom(at({ executeStarted: true }));
    for (const k of ['explore', 'spec', 'plan'] as const) {
      expect(p[k].canMutate).toBe(false);
      expect(p[k].reason).toBe('Locked — execution is in progress.');
    }
    expect(p.execute.canMutate).toBe(true);
  });

  it('changes the design reason once execution has finished', () => {
    const p = stagePermissionsFrom(at({ executeStarted: true, executeDone: true }));
    expect(p.plan.reason).toBe('Locked — execution has completed.');
    expect(p.execute.canMutate).toBe(false);
    expect(p.execute.reason).toBe('Locked — execution is complete.');
  });

  it('freezes Review and Journal only once each is itself done', () => {
    expect(stagePermissionsFrom(at({ reviewDone: true })).review.canMutate).toBe(false);
    expect(stagePermissionsFrom(at({ reviewDone: true })).journal.canMutate).toBe(true);
    expect(stagePermissionsFrom(at({ journalDone: true })).journal.reason).toBe('Locked — journal is complete.');
  });

  it('never sets a reason on an editable stage — the two must not disagree', () => {
    const cases = [at(), at({ executeStarted: true }), at({ executeStarted: true, executeDone: true, reviewDone: true, journalDone: true })];
    for (const c of cases) {
      for (const perm of Object.values(stagePermissionsFrom(c))) {
        expect(perm.canMutate ? perm.reason === undefined : typeof perm.reason === 'string').toBe(true);
      }
    }
  });

  it('locks or opens all six together for the whole-project cases', () => {
    expect(Object.values(allStagesLocked('Project is complete.')).every((p) => !p.canMutate)).toBe(true);
    expect(Object.values(allStagesOpen()).every((p) => p.canMutate)).toBe(true);
  });

  it('maps every stage kind to a real permission key', () => {
    const perms = stagePermissionsFrom(at());
    for (const kind of STAGE_KIND) {
      expect(perms[permKeyFor(kind)], kind).toBeDefined();
    }
    expect(permKeyFor('exploration')).toBe('explore');
  });
});
