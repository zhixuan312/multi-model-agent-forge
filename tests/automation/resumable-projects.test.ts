// @vitest-environment node
/**
 * A restart must not undo a Stop.
 *
 * The boot sweep asked for `autoMode = true` OR `details.automation.status = 'running'`,
 * under a comment calling `autoMode` the legacy field. It is not legacy: `driver.ts`
 * re-reads it every iteration and returns when false, so it is the live kill switch. The
 * two are written by separate statements, and the OR mishandled both windows between them —
 * most seriously the one inside `take_over`, which sets the status FIRST, so a crash there
 * left `autoMode = true` with status `off` and the next boot restarted automation a human
 * had just stopped.
 *
 * The operator is checked in the source. That is deliberate, not a shortcut: the defect is
 * a single token in a WHERE clause, Drizzle's clause object is a cyclic structure with no
 * stable serialization to assert against, and a mock DB returns whatever rows it is handed
 * regardless of the predicate — so a "behavioural" test here would pass under either
 * operator. Source is where this property actually lives.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listResumableProjects } from '@/automation/resumable-projects';
import { createMockDb } from '../test-utils/mock-db';

const SRC = readFileSync(join(process.cwd(), 'src/automation/resumable-projects.ts'), 'utf8');
/** The query only — so the docstring explaining the old `or(` cannot satisfy the check. */
const QUERY = SRC.slice(SRC.indexOf('export async function listResumableProjects'));

describe('listResumableProjects', () => {
  it('found the query — a bad slice must not pass vacuously', () => {
    expect(QUERY).toContain('.from(project)');
    expect(QUERY).toContain('.where(');
  });

  it('requires both signals, never either', () => {
    expect(QUERY, 'the predicate must be a conjunction').toMatch(/\band\(/);
    expect(QUERY, 'an OR resumes a project that is stopped by one of the two fields').not.toMatch(/\bor\(/);
  });

  it('reads both the auto_mode column and the details status', () => {
    expect(QUERY).toContain('project.autoMode');
    expect(QUERY).toContain("'automation'");
    expect(QUERY).toContain("'running'");
  });

  it('filters at all — an unfiltered sweep would resume every project in the database', async () => {
    const db = createMockDb({ 'select:project': [{ id: 'p1', name: 'Atlas' }] });
    await expect(listResumableProjects(db as never)).resolves.toEqual([{ id: 'p1', name: 'Atlas' }]);
    expect(db._callsFor('project').some((c) => c.method === 'where')).toBe(true);
  });

  /** The one caller. A sweep nothing calls protects nothing. */
  it('is what instrumentation.ts boots with', () => {
    const inst = readFileSync(join(process.cwd(), 'instrumentation.ts'), 'utf8');
    expect(inst).toContain('listResumableProjects');
    expect(inst, 'the raw predicate must not be re-inlined at the call site').not.toMatch(/autoMode, true/);
  });
});
