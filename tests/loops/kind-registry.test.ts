// @vitest-environment node
import { LOOP_KINDS, getLoopKind, parseLoopConfig, maintenanceConfigSchema } from '@/loops/kind-registry';

describe('LOOP_KINDS registry', () => {
  it('registers the maintenance kind with a label, config schema, and prompt builder', () => {
    expect(Object.keys(LOOP_KINDS)).toEqual(['maintenance']);
    const def = getLoopKind('maintenance');
    expect(def.label).toBe('Maintenance');
    expect(typeof def.buildPrompt).toBe('function');
  });
});

describe('maintenanceConfigSchema', () => {
  it('accepts a non-empty goal and trims it', () => {
    const r = maintenanceConfigSchema.safeParse({ goalMd: '  clean up dormant code  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.goalMd).toBe('clean up dormant code');
  });

  it('rejects an empty/missing goal', () => {
    expect(maintenanceConfigSchema.safeParse({ goalMd: '   ' }).success).toBe(false);
    expect(maintenanceConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe('parseLoopConfig', () => {
  it('validates config against the kind schema', () => {
    expect(parseLoopConfig('maintenance', { goalMd: 'x' })).toEqual({ ok: true, data: { goalMd: 'x' } });
    expect(parseLoopConfig('maintenance', { goalMd: '' }).ok).toBe(false);
  });
});

describe('maintenance buildPrompt', () => {
  it('embeds the goal text in the worker prompt', () => {
    const prompt = getLoopKind('maintenance').buildPrompt({ goalMd: 'NO DORMANT CODE' });
    expect(prompt).toContain('NO DORMANT CODE');
  });
});
