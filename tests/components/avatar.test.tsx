import { render, screen } from '@testing-library/react';
import { Avatar } from '@/components/ui/avatar';
import { AvatarGroup } from '@/components/ui/avatar-group';

describe('Avatar', () => {
  it('derives initials from a name, first + last', () => {
    render(<Avatar name="Ada Lovelace" data-testid="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('AL');
  });

  it('takes the first two letters of a single-word name', () => {
    render(<Avatar name="Ada" data-testid="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('AD');
  });

  it('falls back to ? for an empty name', () => {
    render(<Avatar name="   " data-testid="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('?');
  });

  it('sets no aria-label — it renders a span, where ARIA discards one', () => {
    // Pinning the contract, not the implementation detail: the previous aria-label read as
    // "accessibility handled" while reaching no screen reader. The name must come from the
    // caller (adjacent text, `title`, or a Tooltip).
    render(<Avatar name="Ada Lovelace" data-testid="a" />);
    expect(screen.getByTestId('a')).not.toHaveAttribute('aria-label');
  });

  it('still forwards an explicit title, which IS a valid name source on a span', () => {
    render(<Avatar name="Ada Lovelace" title="Ada Lovelace" data-testid="a" />);
    expect(screen.getByTestId('a')).toHaveAttribute('title', 'Ada Lovelace');
  });
});

describe('AvatarGroup', () => {
  const members = [{ name: 'Ada Lovelace' }, { name: 'Bo Chen' }, { name: 'Priya Nair' }, { name: 'Xu Zheng' }];

  it('shows at most `max` avatars and collapses the rest into +N', () => {
    const { container } = render(<AvatarGroup members={members} max={2} />);
    expect(container).toHaveTextContent('+2');
  });

  it('renders no +N chip when everyone fits', () => {
    const { container } = render(<AvatarGroup members={members.slice(0, 2)} max={3} />);
    expect(container).not.toHaveTextContent('+');
  });

  it('hides the whole stack from assistive tech, +N included', () => {
    // A bare "+2" announced mid-sentence has nothing to attach to; the names are carried
    // as text beside the group.
    const { container } = render(<AvatarGroup members={members} max={2} />);
    const visible = [...container.querySelectorAll('span')].filter((el) => !el.closest('[aria-hidden="true"]'));
    expect(visible).toHaveLength(0);
  });
});
