import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  APP_SHELL_VARIANTS, CONTENT_SHELL_VARIANTS, LEFT_PANEL_VARIANTS,
  RIGHT_PANEL_VARIANTS, STAGE_FLOW_VARIANTS, defaultEnabledAffordances,
} from '@/components/governance/variant-meta';
import { AppShellVariant } from '@/components/governance/AppShellPreview';
import { ContentAreaVariant } from '@/components/governance/ContentAreaPreview';
import { LeftPanelVariant } from '@/components/governance/LeftPanelPreview';
import { RightPanelVariant } from '@/components/governance/RightPanelPreview';
import { StageFlowVariant } from '@/components/governance/StageFlowPreview';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/settings/org/components',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Every variant is declared as DATA in `variant-meta.ts` and rendered by a `RENDERS` map
 * keyed by that id, in a separate 'use client' module. Each render site falls back to
 * `null` for an unknown id, so a variant added to the meta without a renderer — or an id
 * typo on either side — produces a silently BLANK sub-page in the governance catalog
 * rather than any error. Nothing connected the two halves.
 */
const GROUPS = [
  ['App shell', APP_SHELL_VARIANTS, (id: string) => <AppShellVariant id={id} />],
  ['Content shell', CONTENT_SHELL_VARIANTS, (id: string, on?: ReadonlySet<string>) => <ContentAreaVariant id={id} enabled={on} />],
  ['Left panel', LEFT_PANEL_VARIANTS, (id: string, on?: ReadonlySet<string>) => <LeftPanelVariant id={id} enabled={on} />],
  ['Right panel', RIGHT_PANEL_VARIANTS, (id: string, on?: ReadonlySet<string>) => <RightPanelVariant id={id} enabled={on} />],
  ['Stage flow', STAGE_FLOW_VARIANTS, (id: string) => <StageFlowVariant id={id} />],
] as const;

describe('every declared variant actually renders', () => {
  it('covers a non-trivial number of variants — a broken accessor must not pass vacuously', () => {
    const total = GROUPS.reduce((n, [, variants]) => n + variants.length, 0);
    expect(total).toBeGreaterThan(10);
  });

  for (const [label, variants, renderOne] of GROUPS) {
    for (const v of variants) {
      it(`${label} › ${v.id} renders something`, () => {
        const { container } = render(<>{renderOne(v.id, defaultEnabledAffordances(v))}</>);
        expect(container.textContent?.trim(), `${label}/${v.id} rendered blank`).not.toBe('');
      });
    }
  }
});
/**
 * An affordance names the component it is illustrating. The Table's `rowActions`
 * declared `DropdownMenu` and drew a bare `<button>` — the picture contradicting the
 * entry printed beside it, in the one surface whose job is to show what conformance
 * looks like.
 */
describe('an affordance preview uses the component it names', () => {
  it('Table row actions render a real menu trigger, not a bare button', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<LeftPanelVariant id="table" enabled={new Set(['rowActions'])} />);

    const trigger = screen.getAllByRole('button', { name: 'Row actions' })[0]!;
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(trigger);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
});
