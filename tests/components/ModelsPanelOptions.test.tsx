// @vitest-environment jsdom
/**
 * The protocol chooser offers every value of `DIALECTS`.
 *
 * `Dialect` was written out three times — the union in `mma/configure-provider.ts`,
 * `z.enum(['claude', 'codex'])` in the configure-provider route, and this form's options —
 * and none could see the others. `db/enums.ts`'s single-source ratchet reads only that file,
 * and an enum re-spelled as `{ value, label }` objects is invisible to it regardless: the
 * literal array it extracts is twice the enum's length, so it fails the superset-within-one
 * test. Same blind spot that hid `LoopForm`'s mode options.
 *
 * `claude` and `codex` are WIRE PROTOCOLS, not vendors — a third one is a real possibility,
 * and it must not be able to type-check everywhere while never appearing here.
 */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { DIALECTS } from '@/mma/configure-provider';
import { ModelsPanel } from '@/../app/(app)/settings/models/ModelsPanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe('ModelsPanel offers every wire protocol', () => {
  it('renders one Dialect option per DIALECTS value', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<ModelsPanel tiers={{ main: null, complex: null, standard: null }} suggestions={[]} />);
    // The chooser lives inside a tier's edit form — open one.
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);

    const group = screen.getByRole('radiogroup', { name: 'Dialect' });
    const labels = [...group.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toHaveLength(DIALECTS.length);
    for (const d of DIALECTS) {
      expect(labels, `${d} has no option`).toContain(d);
    }
  });
});
