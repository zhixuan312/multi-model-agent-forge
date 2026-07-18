// @vitest-environment node
import {
  getComponentGovernanceView,
  resolveGovernedSlot,
  updateComponentGovernance,
} from '@/config/component-governance-core';
import { createBaseComponentGovernance } from '../test-utils/factories';
import { createMockDb, seq } from '../test-utils/mock-db';

describe('component-governance core', () => {
  it('returns registry defaults when the singleton row is missing', async () => {
    const db = createMockDb();
    const view = await getComponentGovernanceView({ db });
    expect(view.slots).toHaveLength(14);
    // stageFlow has no knobs (its page is a scenario gallery); a knob-bearing slot keeps its defaults.
    expect(view.slots.find((slot) => slot.slotId === 'stageFlow')).toMatchObject({ locked: true, knobs: {} });
    expect(view.slots.find((slot) => slot.slotId === 'badge')).toMatchObject({
      locked: true,
      knobs: { variant: 'neutral', size: 'md', dot: false, icon: false },
    });
  });

  it('rejects unknown knob names', async () => {
    const db = createMockDb();
    const result = await updateComponentGovernance(
      { slots: { badge: { locked: true, knobs: { unknownKnob: true } } } },
      { db },
    );
    expect(result).toEqual({ kind: 'invalid', message: 'Invalid governance fields.' });
    expect(db._calls).toHaveLength(0);
  });

  it('round-trips lock and knob values through the singleton row', async () => {
    const saved = createBaseComponentGovernance({
      slotStateJson: {
        metricCard: { locked: true, knobs: { tone: 'attention', iconTint: 'neutral', muted: false } },
      },
    });
    const db = createMockDb({
      'select:component_governance': seq([], [saved], [saved]),
      'insert:component_governance': [saved],
    });

    const write = await updateComponentGovernance(
      { slots: { metricCard: { locked: true, knobs: { tone: 'attention' } } } },
      { db },
    );
    expect(write.kind).toBe('saved');

    const resolved = await resolveGovernedSlot('metricCard', { db });
    expect(resolved).toEqual({
      slotId: 'metricCard',
      locked: true,
      knobs: { tone: 'attention', iconTint: 'neutral', muted: false },
    });
  });

  it('deep-merges a partial knob patch onto existing stored knobs without dropping the others', async () => {
    const stored = createBaseComponentGovernance({
      slotStateJson: {
        badge: { locked: false, knobs: { variant: 'neutral', size: 'md', dot: true, icon: false } },
      },
    });
    const db = createMockDb({ 'select:component_governance': [stored] });

    await updateComponentGovernance({ slots: { badge: { locked: true, knobs: { variant: 'accent' } } } }, { db });

    const setCall = db._calls.find((c) => c.op === 'update' && c.method === 'set');
    expect((setCall?.args[0] as { slotStateJson: Record<string, unknown> }).slotStateJson.badge).toEqual({
      locked: true,
      knobs: { variant: 'accent', size: 'md', dot: true, icon: false },
    });
  });

  it('locks the singleton row FOR UPDATE so concurrent writers serialize', async () => {
    const stored = createBaseComponentGovernance({ slotStateJson: {} });
    const db = createMockDb({ 'select:component_governance': [stored] });

    await updateComponentGovernance({ slots: { metricCard: { locked: true, knobs: { tone: 'attention' } } } }, { db });

    const forCall = db._calls.find((c) => c.method === 'for');
    expect(forCall?.args[0]).toBe('update');
  });

  it('recovers from a lost singleton-insert race by re-reading and updating', async () => {
    const created = createBaseComponentGovernance({
      slotStateJson: { metricCard: { locked: true, knobs: { tone: 'attention' } } },
    });
    const db = createMockDb({
      // 1st read (no row) → insert throws unique-violation → 2nd read (now present) → getView read
      'select:component_governance': seq([], [created], [created]),
      'insert:component_governance': new Error('duplicate key value violates unique constraint'),
    });

    const result = await updateComponentGovernance(
      { slots: { metricCard: { locked: true, knobs: { tone: 'attention' } } } },
      { db },
    );

    expect(result.kind).toBe('saved');
    expect(db._assertCalled('component_governance', 'update')).toBe(true);
  });

  it('drops stale persisted slot ids and falls back to registry defaults on read', async () => {
    const db = createMockDb({
      'select:component_governance': [
        createBaseComponentGovernance({
          slotStateJson: {
            badge: { locked: true, knobs: { variant: 'accent' } },
            staleSlot: { locked: true, knobs: { nope: true } } as never,
          },
        }),
      ],
    });

    const view = await getComponentGovernanceView({ db });
    // A valid persisted partial knob merges onto defaults…
    expect(view.slots.find((slot) => slot.slotId === 'badge')?.knobs).toEqual({
      variant: 'accent',
      size: 'md',
      dot: false,
      icon: false,
    });
    // …a stale slot id no longer in the registry is silently dropped (not present in the view)…
    expect(view.slots.find((slot) => (slot.slotId as string) === 'staleSlot')).toBeUndefined();
    // …and a knob-less slot resolves to empty knobs.
    expect(view.slots.find((slot) => slot.slotId === 'stageFlow')?.knobs).toEqual({});
  });
});
