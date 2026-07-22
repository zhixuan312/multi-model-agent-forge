import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

let pathname = '/projects';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
// Sidebar pulls in a lot; stub it — MobileNav's own open/close is what we test.
vi.mock('@/components/forge/Sidebar', () => ({ Sidebar: () => <nav data-testid="sidebar" /> }));

import { MobileNav } from '@/components/forge/MobileNav';
const member = { id: 'm', username: 'u', displayName: 'U', avatarTint: '#000', role: 'member', teamId: 't' } as never;

describe('MobileNav (QA F#6 — drawer closes on navigation)', () => {
  it('closes the drawer when the route changes', () => {
    pathname = '/projects';
    const { rerender } = render(<MobileNav member={member} />);
    fireEvent.click(screen.getByTestId('drawer-toggle'));
    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    // Navigate (soft): pathname changes, MobileNav stays mounted → effect must close it.
    pathname = '/journal';
    rerender(<MobileNav member={member} />);
    expect(screen.queryByTestId('drawer')).toBeNull();
  });
});
