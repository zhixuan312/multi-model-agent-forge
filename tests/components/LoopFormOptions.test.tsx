// @vitest-environment jsdom
/**
 * The mode and worker-tier choosers are derived from their enums.
 *
 * `LoopForm` already carried a comment saying a local `LoopMode` union had been removed "so
 * a new mode would have compiled here while the form silently offered three" — while the
 * OPTIONS were still hand-listed, which is precisely what produces that outcome. A value
 * added to `LOOP_MODE` type-checks everywhere and never appears in the form.
 *
 * The enum ratchet cannot see this shape: the values sit inside `{ value, label }` objects,
 * so the literal array it extracts is twice the enum's length and fails its
 * superset-within-one test. This is the check instead.
 */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { LOOP_MODE, LOOP_WORKER_TIER } from '@/db/enums';
import { LoopForm } from '@/../app/(app)/loops/LoopForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const renderForm = () =>
  render(<LoopForm mode="add" repoOptions={[{ id: 'r1', name: 'repo-a' }]} onDone={vi.fn()} />);

describe('LoopForm offers every enum value', () => {
  it('renders one Mode option per LOOP_MODE value', () => {
    renderForm();
    const group = screen.getByRole('radiogroup', { name: 'Mode' });
    const labels = [...group.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toHaveLength(LOOP_MODE.length);
    for (const m of LOOP_MODE) {
      expect(labels.some((l) => l?.toLowerCase() === m.toLowerCase()), `${m} has no option`).toBe(true);
    }
  });

  it('renders one Worker tier option per LOOP_WORKER_TIER value', () => {
    renderForm();
    const group = screen.getByRole('radiogroup', { name: 'Worker tier' });
    const labels = [...group.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toHaveLength(LOOP_WORKER_TIER.length);
    for (const t of LOOP_WORKER_TIER) {
      expect(labels.some((l) => l?.toLowerCase() === t.toLowerCase()), `${t} has no option`).toBe(true);
    }
  });
});
