import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transitionSchema, ACTION_KINDS } from '@/automation/action-schema';

/**
 * `ACTION_KINDS` and the executor's switch must be the same set — in BOTH directions.
 *
 * Only one direction was checked: every kind has a case. The reverse — a case for a kind
 * the enum no longer carries — is the dormant-code direction, and it is the one that
 * survives a rename: drop a kind from the enum and its case sits there unreachable,
 * looking like live handling of an action nothing can request.
 */
describe('action coverage (Task 8b-4) — no dormant kind', () => {
  const EXECUTOR = readFileSync(join(process.cwd(), 'src/automation/details-actions.ts'), 'utf8');
  const cases = [...new Set([...EXECUTOR.matchAll(/^\s*case '([a-z_]+)':/gm)].map((m) => m[1]!))];

  it('found the switch — a broken match must not pass vacuously', () => {
    expect(cases.length).toBeGreaterThan(10);
    expect(cases).toContain('take_over');
  });

  it('every ACTION_KIND has an executeDetailsAction case (one implementation each)', () => {
    const missing = ACTION_KINDS.filter((k) => !cases.includes(k));
    expect(missing, 'the action is accepted at the boundary and handled nowhere').toEqual([]);
  });

  it('every executor case is a kind the boundary still accepts', () => {
    const orphans = cases.filter((c) => !(ACTION_KINDS as readonly string[]).includes(c));
    expect(orphans, 'unreachable case — no request can carry this kind past transitionSchema').toEqual([]);
  });
});

describe('transitionSchema (POST /transition boundary)', () => {
  it('parses a bare action kind', () => {
    const r = transitionSchema.safeParse({ action: 'dispatch_audit' });
    expect(r.success).toBe(true);
  });
  it('parses an action + data payload', () => {
    const r = transitionSchema.safeParse({ action: 'set_brief', data: { text: 'hello' } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.data).toEqual({ text: 'hello' });
  });
  it('rejects an unknown action kind', () => {
    expect(transitionSchema.safeParse({ action: 'delete_everything' }).success).toBe(false);
  });
  it('rejects a missing action', () => {
    expect(transitionSchema.safeParse({ data: { x: 1 } }).success).toBe(false);
  });
  it('covers every action kind the executor/UI reference (no gap)', () => {
    // Every kind the enum carries parses — the enum is the single boundary list, and the
    // count is deliberately not written down here: this comment said "all 30" when there
    // were 27, which is the shape of claim that rots the moment a kind is added or removed.
    expect(ACTION_KINDS.length).toBe(new Set(ACTION_KINDS).size); // no dupes
    for (const k of ACTION_KINDS) {
      expect(transitionSchema.safeParse({ action: k }).success).toBe(true);
    }
  });
});
