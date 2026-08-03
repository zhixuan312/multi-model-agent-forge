// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A project route refuses in one of two ways, and which one is a security decision:
 *   - READ  → 404. Anti-enumeration: an unreadable project must be indistinguishable
 *             from a missing one, so a caller probing ids learns nothing.
 *   - WRITE → 403. The caller already knows the project exists — they are trying to
 *             change it — so there is nothing left to hide.
 *
 * Seven routes open-coded the read gate and ONE of them (`pending-handlers`) returned
 * 403, telling an authenticated cross-team probe exactly what the other six hid.
 * `guardProjectRead` / `guardProjectWrite` are the two answers; a route should reach for
 * one, not restate it.
 */
const ROOT = process.cwd();
const DIR = 'app/api/projects';

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...routes(rel));
    else if (e.name === 'route.ts') out.push(rel);
  }
  return out;
}

describe('project API routes use the shared gates', () => {
  const files = routes(DIR);

  it('scanned the project route tree', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no route open-codes the membership check', () => {
    const offenders = files.filter((rel) => {
      const t = readFileSync(join(ROOT, rel), 'utf8');
      return /assertProjectReadable\s*\(/.test(t);
    });
    expect(offenders, 'use guardProjectRead / guardProjectWrite').toEqual([]);
  });

  it('no route hand-writes a Forbidden that the write guard already owns', () => {
    const offenders = files.filter((rel) =>
      /error: 'Forbidden' \}, \{ status: 403 \}/.test(readFileSync(join(ROOT, rel), 'utf8')),
    );
    expect(offenders, 'guardProjectWrite returns this; a read must 404 instead').toEqual([]);
  });
});
