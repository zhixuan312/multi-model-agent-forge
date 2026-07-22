import { render, act } from '@testing-library/react';
import { AppPhaseTheme } from '@/components/forge/AppPhaseTheme';
import { PhaseFromRoute } from '@/components/forge/PhaseFromRoute';
import { appPhaseStore } from '@/components/forge/app-phase';

afterEach(() => { act(() => appPhaseStore.set('design')); });

describe('shell-level phase theme (cold mode reaches the sidebar)', () => {
  it('AppPhaseTheme sets data-phase from the shared store', () => {
    const { container } = render(<AppPhaseTheme className="text-ink"><span>x</span></AppPhaseTheme>);
    const root = container.querySelector('[data-phase]')!;
    expect(root).toHaveAttribute('data-phase', 'design'); // warm default
    act(() => appPhaseStore.set('build'));
    expect(root).toHaveAttribute('data-phase', 'build');  // whole shell goes cold
  });

  it('PhaseFromRoute publishes build when a project is automating, and resets on unmount', () => {
    expect(appPhaseStore.get()).toBe('design');
    const { unmount } = render(<PhaseFromRoute auto={true}><span>content</span></PhaseFromRoute>);
    expect(appPhaseStore.get()).toBe('build');   // sidebar/chrome themer will read this
    unmount();
    expect(appPhaseStore.get()).toBe('design');  // leaving the project warms the shell back
  });

  it('a non-automating project keeps the shell warm', () => {
    render(<PhaseFromRoute auto={false}><span>content</span></PhaseFromRoute>);
    expect(appPhaseStore.get()).toBe('design');
  });
});
