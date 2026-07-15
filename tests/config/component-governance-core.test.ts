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
    expect(view.slots).toHaveLength(11);
    expect(view.slots.find((slot) => slot.slotId === 'stageFlow')).toMatchObject({
      locked: true,
      knobs: { condensed: false },
    });
  });

  it('rejects unknown knob names', async () => {
    const db = createMockDb();
    const result = await updateComponentGovernance(
      { slots: { stageFlow: { locked: true, knobs: { unknownKnob: true } } } },
      { db },
    );
    expect(result).toEqual({ kind: 'invalid', message: 'Invalid governance fields.' });
    expect(db._calls).toHaveLength(0);
  });

  it('round-trips lock and knob values through the singleton row', async () => {
    const saved = createBaseComponentGovernance({
      slotStateJson: {
        stageFlow: { locked: true, knobs: { condensed: true } },
      },
    });
    const db = createMockDb({
      'select:component_governance': seq([], [saved], [saved]),
      'insert:component_governance': [saved],
    });

    const write = await updateComponentGovernance(
      { slots: { stageFlow: { locked: true, knobs: { condensed: true } } } },
      { db },
    );
    expect(write.kind).toBe('saved');

    const resolved = await resolveGovernedSlot('stageFlow', { db });
    expect(resolved).toEqual({
      slotId: 'stageFlow',
      locked: true,
      knobs: { condensed: true },
    });
  });

  it('drops stale persisted slot ids and falls back to registry defaults on read', async () => {
    const db = createMockDb({
      'select:component_governance': [
        createBaseComponentGovernance({
          slotStateJson: {
            stageFlow: { locked: true, knobs: { condensed: true } },
            staleSlot: { locked: true, knobs: { nope: true } } as never,
          },
        }),
      ],
    });

    const view = await getComponentGovernanceView({ db });
    expect(view.slots.find((slot) => slot.slotId === 'stageFlow')?.knobs).toEqual({ condensed: true });
    expect(view.slots.find((slot) => slot.slotId === 'badge')?.knobs).toEqual({
      variant: 'neutral',
      size: 'md',
      dot: false,
      icon: false,
    });
  });
});
