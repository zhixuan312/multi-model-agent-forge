import { describe, it, expect } from 'vitest';
import { createMockDb } from '../test-utils/mock-db';
import { SPEC_TEMPLATE_SEEDS } from '@/db/seed/team-spec-template';
import {
  CREATE_PROJECT_FILE_ERROR,
  VALID_SUBSET_RUNS,
  decodeUploadedArtifact,
  validateSubsetSelection,
  parseExplorationUpload,
  parseSpecUpload,
  stripFrontmatter,
} from '@/projects/create-project-subset';

describe('validateSubsetSelection', () => {
  it('accepts the six contiguous subset runs', () => {
    for (const run of VALID_SUBSET_RUNS) {
      expect(validateSubsetSelection(run)).toEqual({ ok: true });
    }
  });

  it('rejects a non-contiguous exploration-plan selection', () => {
    expect(validateSubsetSelection(['exploration', 'plan'])).toEqual({
      ok: false,
      message: 'Choose a contiguous design run.',
    });
  });
});

describe('decodeUploadedArtifact', () => {
  it('rejects oversized uploads', () => {
    const bytes = new Uint8Array(300_001);
    expect(() => decodeUploadedArtifact(bytes)).toThrow(CREATE_PROJECT_FILE_ERROR);
  });

  it('rejects invalid utf8', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(() => decodeUploadedArtifact(bytes)).toThrow(CREATE_PROJECT_FILE_ERROR);
  });
});

describe('parseExplorationUpload', () => {
  it('accepts frontmatter plus background section', () => {
    const body = `---\nversion: 1\nupdated_at: 2026-07-14\n---\n\n## Background\n\nContext`;
    const parsed = parseExplorationUpload(body);
    expect(parsed.ok).toBe(true);
  });
});

describe('stripFrontmatter', () => {
  it('removes a leading frontmatter block so the writer can re-stamp its own', () => {
    const body = `---\nversion: 1\nupdated_at: 2026-07-14\n---\n\n## Background\n\nContext`;
    const stripped = stripFrontmatter(body);
    expect(stripped.startsWith('## Background')).toBe(true);
    // idempotent-safe: content without frontmatter is returned unchanged
    expect(stripFrontmatter('## Background\n\nContext')).toBe('## Background\n\nContext');
  });
});

describe('parseSpecUpload', () => {
  it('maps known top-level headings to canonical template ids and component records', async () => {
    const db = createMockDb({
      'select:team_spec_template': SPEC_TEMPLATE_SEEDS.map((seed, i) => ({
        id: `tpl-${i}`,
        kind: seed.kind,
        label: seed.label,
      })),
    });
    const body = `## Context\n\n### Background\n\nText\n\n## Problem statement\n\n### Problem\n\nProblem text`;
    const result = await parseSpecUpload(db, body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selectedTemplateIds).toHaveLength(2);
      expect(result.value.components).toHaveLength(2);
    }
  });

  it('fails closed on unmappable headings', async () => {
    const db = createMockDb({
      'select:team_spec_template': SPEC_TEMPLATE_SEEDS.map((seed, i) => ({
        id: `tpl-${i}`,
        kind: seed.kind,
        label: seed.label,
      })),
    });
    const body = `## Unknown thing\n\n### Nope\n\nText`;
    await expect(parseSpecUpload(db, body)).resolves.toEqual({
      ok: false,
      message: CREATE_PROJECT_FILE_ERROR,
    });
  });
});
