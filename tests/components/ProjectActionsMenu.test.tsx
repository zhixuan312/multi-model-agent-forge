import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectActionsMenu } from '@/components/forge/ProjectActionsMenu';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { view } = vi.hoisted(() => ({ view: vi.fn() }));
// Mock the LEAF that owns the store, not the component that used to declare it. When the
// store moved out of `AutomationGate.tsx` (to break an import cycle), this mock kept
// resolving — `AutomationGate` still exists — but no longer intercepted anything, so the
// real store ran and `view` was never called. That is the F489 failure mode from the other
// side: a stale mock target does not error, it just stops applying. It went red here only
// because this case asserts the spy WAS called; a case asserting "did not crash" would have
// passed silently with the mock disabled.
vi.mock('@/components/forge/automation-overlay-store', () => ({ automationOverlayStore: { view } }));

const open = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(screen.getByRole('button', { name: 'Project actions' }));
  await screen.findByRole('menu');
  return user;
};

/**
 * This was hand-rolled: `useState` + a `mousedown` listener + a bare `role="menu"` div.
 * That gave it click-outside and nothing else — Escape did not close it, arrows did not
 * move between items, and focus never came back to the trigger. It is on the governed
 * `DropdownMenu` now, and these pin the behaviour that came with it.
 */
describe('ProjectActionsMenu', () => {
  it('renders nothing when the actor can neither view activity nor archive', () => {
    const { container } = render(<ProjectActionsMenu projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Activity only when the project has recorded events', async () => {
    render(<ProjectActionsMenu projectId="p1" eventCount={3} />);
    await open();
    expect(screen.getByRole('menuitem', { name: /Activity/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Archive/ })).toBeNull();
  });

  it('offers Archive only to an actor who may archive, and labels the inverse when archived', async () => {
    const { unmount } = render(<ProjectActionsMenu projectId="p1" canArchive />);
    await open();
    expect(screen.getByRole('menuitem', { name: 'Archive project' })).toBeInTheDocument();
    unmount();

    render(<ProjectActionsMenu projectId="p1" canArchive archived />);
    await open();
    expect(screen.getByRole('menuitem', { name: 'Unarchive project' })).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<ProjectActionsMenu projectId="p1" eventCount={1} canArchive />);
    const user = await open();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('button', { name: 'Project actions' })).toHaveFocus();
  });

  it('activates an item from the keyboard', async () => {
    render(<ProjectActionsMenu projectId="p1" eventCount={1} />);
    const user = await open();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(view).toHaveBeenCalled());
  });
});
