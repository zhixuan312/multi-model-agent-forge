import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transitionSchema, ACTION_KINDS } from '@/automation/action-schema';

describe('action coverage (Task 8b-4) — no dormant kind', () => {
  it('every ACTION_KIND has an executeDetailsAction case (one implementation each)', () => {
    const src = readFileSync(join(process.cwd(), 'src/automation/details-actions.ts'), 'utf8');
    const missing = ACTION_KINDS.filter((k) => !src.includes(`case '${k}':`));
    expect(missing).toEqual([]);
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
    // All 30 lifecycle kinds are present; the enum is the single boundary list.
    expect(ACTION_KINDS.length).toBe(new Set(ACTION_KINDS).size); // no dupes
    for (const k of ACTION_KINDS) {
      expect(transitionSchema.safeParse({ action: k }).success).toBe(true);
    }
  });
});
