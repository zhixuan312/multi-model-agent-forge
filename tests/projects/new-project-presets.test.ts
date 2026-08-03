// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../../app/(app)/projects/new/NewProjectForm';
import { VALID_SUBSET_RUNS } from '@/projects/create-project-subset';
import { STAGE_KIND } from '@/db/enums';

/**
 * The preset list says of itself: "Six are the contiguous design-chain runs
 * (`VALID_SUBSET_RUNS` in create-project-subset.ts); the seventh is Full SDLC." That
 * correspondence is what makes the invalid non-contiguous combos unrepresentable in the
 * UI — the whole reason the picker is a list of presets rather than three checkboxes.
 * It was a comment; a run added to the server list and not the picker would simply be
 * unreachable, and a preset added here without a server run would be REJECTED on submit.
 */
const sig = (run: readonly string[]) => run.join(',');

describe('new-project presets mirror the server subset runs', () => {
  const subsets = PRESETS.filter((p) => p.stages.length > 0);
  const full = PRESETS.filter((p) => p.stages.length === 0);

  it('has exactly one Full SDLC preset, expressed as the empty selection', () => {
    expect(full).toHaveLength(1);
    expect(full[0]!.key).toBe('full');
  });

  it('offers every valid server run, and only valid runs', () => {
    expect(subsets.map((p) => sig(p.stages)).sort()).toEqual(VALID_SUBSET_RUNS.map(sig).sort());
  });

  it('gives every preset a distinct key and a non-empty description', () => {
    expect(new Set(PRESETS.map((p) => p.key)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.title.trim(), p.key).not.toBe('');
      expect(p.produces.trim(), p.key).not.toBe('');
    }
  });

  /** A run starting past exploration cannot invent its input — it must ask for an upload. */
  it('requires an upstream artifact for exactly the runs that do not start at exploration', () => {
    for (const p of subsets) {
      const startsAtExploration = p.stages[0] === 'exploration';
      expect(Boolean(p.requires), p.key).toBe(!startsAtExploration);
    }
    expect(PRESETS.find((p) => p.key === 'plan')!.requires).toBe('spec');
    expect(PRESETS.find((p) => p.key === 'spec')!.requires).toBe('exploration');
  });

  it('only names real design stages', () => {
    for (const p of PRESETS) {
      for (const s of p.stages) expect(STAGE_KIND).toContain(s);
    }
  });
});
