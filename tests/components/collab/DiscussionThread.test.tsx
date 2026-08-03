import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiscussionThread } from '@/components/forge/collab/DiscussionThread';
import type { DiscussionMsg, MemberRef } from '@/collab/types';

vi.mock('@/components/forge/ForgeMark', () => ({ ForgeMark: () => <span data-testid="forge-mark" /> }));

const me: MemberRef = { id: 'me', displayName: 'Ada Lovelace', avatarTint: '#355a74' };
const bo: MemberRef = { id: 'bo', displayName: 'Bo Chen', avatarTint: '#b23a48' };
const pool = [me, bo];
const memberById = (id: string) => pool.find((m) => m.id === id);

const thread = (messages: DiscussionMsg[]) =>
  render(
    <DiscussionThread
      messages={messages}
      memberById={memberById}
      currentMemberId="me"
      mentionPool={pool}
    />,
  );

/**
 * The bubble used to branch on AUTHORSHIP: the current member's own messages went through a
 * plain-text pass (mentions highlighted, markdown raw) and everyone else's through ProseBlock
 * (markdown rendered, mentions not). So a teammate @-mentioning you was not highlighted — the
 * case the feature exists for — and your own `**bold**` showed its asterisks to you while
 * rendering bold for everyone else. One message, two appearances, decided by who was looking.
 */
describe('DiscussionThread renders every bubble the same way', () => {
  const withMarkdownAndMention = (id: string, authorId: string): DiscussionMsg => ({
    id, authorId, body: 'Hey @Bo Chen, this is **important**.',
  });

  it.each([
    ['my own message', 'me'],
    ['a teammate’s message', 'bo'],
    ['Forge’s message', 'forge'],
  ])('renders markdown in %s', (_label, authorId) => {
    const { container } = thread([withMarkdownAndMention('m1', authorId)]);
    expect(container.querySelector('strong')).not.toBeNull();
    // …and never leaks the raw syntax.
    expect(container.textContent).not.toContain('**');
  });

  it.each([
    ['my own message', 'me'],
    ['a teammate’s message', 'bo'],
  ])('highlights the @-mention in %s', (_label, authorId) => {
    thread([withMarkdownAndMention('m1', authorId)]);
    const mention = screen.getByText('@Bo Chen');
    expect(mention.className).toMatch(/text-accent/);
  });

  it('leaves a mention inside a code fence alone — that is text the author typed as code', () => {
    const { container } = thread([{ id: 'm1', authorId: 'bo', body: '```\n@Bo Chen\n```' }]);
    const code = container.querySelector('code');
    expect(code?.textContent).toContain('@Bo Chen');
    expect(code?.querySelector('.text-accent')).toBeNull();
  });

  it('renders nothing at all for an empty thread that is not awaiting a reply', () => {
    const { container } = thread([]);
    expect(container.firstChild).toBeNull();
  });
});
