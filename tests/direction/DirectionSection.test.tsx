import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DirectionSection } from '@/components/direction/DirectionSection';
import { DIRECTION_SECTIONS } from '@/content/direction-sections';

/**
 * `DirectionSection` dispatches on `section.component` through a chain of seven equality
 * checks, each rendering `&&`. A value with no matching branch renders NOTHING — no
 * error, no fallback — so a component added to the union and to a section but not to the
 * chain would silently drop that section's visual, leaving only its prose.
 *
 * Differential, so it stays true for values that do not exist yet: a section that
 * declares a component must render strictly more than the same section without one.
 */
describe('DirectionSection visuals', () => {
  const withComponent = DIRECTION_SECTIONS.filter((s) => s.component);

  it('covers every structured component the registry actually uses', () => {
    const used = new Set(withComponent.map((s) => s.component));
    expect(used.size).toBeGreaterThanOrEqual(7);
  });

  for (const section of withComponent) {
    it(`${section.id} renders its "${section.component}" visual, not just its prose`, () => {
      const full = render(<DirectionSection section={section} />).container.textContent ?? '';
      const proseOnly = render(
        <DirectionSection section={{ ...section, component: undefined }} />,
      ).container.textContent ?? '';
      expect(full.length, `${section.component} rendered no visual`).toBeGreaterThan(proseOnly.length);
    });
  }
});
