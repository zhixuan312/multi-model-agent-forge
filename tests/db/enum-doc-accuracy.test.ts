// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENT_KIND, COMPONENT_STATUS, EXPORT_FORMAT } from '@/db/enums';

/**
 * `db/enums.ts` is the canonical value source for every fixed-value column, so its
 * comments are the first thing a reader trusts. Four had drifted: COMPONENT_KIND named
 * `nfr`/`assumptions` as its two unticked-by-default components (neither kind exists
 * anywhere), COMPONENT_STATUS described a FOUR-state machine with a `satisfied` state and
 * a per-section roll-up (three states, no sections, no roll-up), and EXPORT_FORMAT called
 * `pdf`/`bundle` "inert" long after the PDF subsystem shipped.
 *
 * This pins the checkable half: a value the doc NAMES must be in the tuple.
 */
const ENUMS_SRC = readFileSync(join(process.cwd(), 'src/db/enums.ts'), 'utf8');

/** Backtick-quoted single-word values mentioned in the doc block above a declaration. */
function docValuesFor(constName: string): string[] {
  const at = ENUMS_SRC.indexOf(`export const ${constName}`);
  expect(at, `${constName} not found`).toBeGreaterThan(-1);
  const docStart = ENUMS_SRC.lastIndexOf('/**', at);
  if (docStart < 0) return [];
  const doc = ENUMS_SRC.slice(docStart, at);
  return [...doc.matchAll(/`([a-z][a-z_]*)`/g)].map((m) => m[1]);
}

describe('enum docs only name values the enum has', () => {
  it.each([
    ['COMPONENT_KIND', COMPONENT_KIND],
    ['COMPONENT_STATUS', COMPONENT_STATUS],
    ['EXPORT_FORMAT', EXPORT_FORMAT],
  ])('%s', (name, values) => {
    const KNOWN_NON_VALUES = new Set([
      'default', 'export', 'md', 'record', 'loadoutline', 'approved', 'drafted', 'gathering',
    ]);
    const named = docValuesFor(name).filter((v) => !KNOWN_NON_VALUES.has(v.toLowerCase()));
    const unknown = named.filter((v) => !(values as readonly string[]).includes(v));
    expect(unknown, `${name}'s doc names values it does not have`).toEqual([]);
  });
});
