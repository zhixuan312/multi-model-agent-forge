import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('action-log retirement — group A seams', () => {
  it('projects-core, spec-core, and exploration/dispatch no longer reference logAction', () => {
    for (const path of ['src/projects/projects-core.ts', 'src/spec/spec-core.ts', 'src/exploration/dispatch.ts']) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/logAction/);
    }
  });
});

describe('action-log retirement — group B seams', () => {
  it('explore-core, export/record, and dispatch-helpers no longer reference logAction', () => {
    for (const path of ['src/exploration/explore-core.ts', 'src/export/record.ts', 'src/dispatch/dispatch-helpers.ts']) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/logAction/);
    }
  });
});
