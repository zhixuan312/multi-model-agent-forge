import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ParticipantStrip } from '@/components/forge/collab/Participants';
import type { Participant } from '@/collab/types';

const bo = { id: 'bo', displayName: 'Bo Chen', avatarTint: '#355a74' };
const priya = { id: 'priya', displayName: 'Priya Nair', avatarTint: '#b23a48' };

const parts: Participant[] = [
  { member: bo, approved: true },
  { member: priya, approved: false },
];

const strip = (props: Partial<React.ComponentProps<typeof ParticipantStrip>> = {}) =>
  render(
    <TooltipProvider>
      <ParticipantStrip participants={parts} pool={[]} onAdd={vi.fn()} {...props} />
    </TooltipProvider>,
  );

describe('ParticipantStrip', () => {
  it('defaults to approval semantics — heading "Approvers", pending avatars dimmed', () => {
    const { container } = strip();
    expect(screen.getByText('Approvers')).toBeInTheDocument();
    expect(container.querySelectorAll('.opacity-55')).toHaveLength(1); // priya only
  });

  /**
   * The plan approves per TASK, not per member, so every plan participant is permanently
   * `approved: false`. Rendering approval state there dimmed the entire roster and
   * tooltipped everyone "not yet approved" forever — a promise the plan never keeps.
   */
  it('renders a plain roster when the surface has no per-member approval', () => {
    const { container } = strip({ label: 'Reviewers', showApproval: false });
    expect(screen.getByText('Reviewers')).toBeInTheDocument();
    expect(screen.queryByText('Approvers')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.opacity-55')).toHaveLength(0);
  });

  it('never claims approval for an approved member when approval is not tracked', () => {
    const { container } = strip({ showApproval: false });
    // The check badge is the approved-only affordance.
    expect(container.querySelector('.bg-\\[var\\(--sage\\)\\]')).toBeNull();
  });

  it('still shows the check badge for an approved member by default', () => {
    const { container } = strip();
    expect(container.querySelector('.bg-\\[var\\(--sage\\)\\]')).not.toBeNull();
  });

  it('lists every participant either way', () => {
    const { container } = strip({ showApproval: false });
    const avatars = within(container).getAllByText(/^(BC|PN)$/);
    expect(avatars).toHaveLength(2);
  });
});
