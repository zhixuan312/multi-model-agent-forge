import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toasts } = vi.hoisted(() => ({ toasts: [] as Array<{ type: string; message: string }> }));
vi.mock('@/components/ui/toast', () => ({ showToast: (t: { type: string; message: string }) => { toasts.push(t); } }));
import { ConversationComposer } from '@/components/patterns/conversation';

/**
 * Only the COMPOSER is left. `Message`, `MessageList` and `ConversationPane` were deleted
 * with their cases: a three-layer message-rendering stack whose only callers were each
 * other and this file. Every stage client renders its own transcript, because each shows
 * different per-message metadata — the generic version had no user.
 */
describe('ConversationComposer', () => {
  it('submits trimmed text and clears input', () => {
    const onSend = vi.fn();
    render(<ConversationComposer onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '  Hello  ' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith('Hello');
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('does not submit empty text', () => {
    const onSend = vi.fn();
    render(<ConversationComposer onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables when disabled prop is true', () => {
    render(<ConversationComposer onSend={() => {}} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('shows custom submit label', () => {
    render(<ConversationComposer onSend={() => {}} submitLabel="Send answer" />);
    expect(screen.getByRole('button', { name: /send answer/i })).toBeInTheDocument();
  });
});

describe('ConversationComposer voice errors (QA F#5)', () => {
  it('surfaces an error toast when mic permission is denied, not a silent no-op', async () => {
    toasts.length = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    render(<ConversationComposer value="" onChange={() => {}} onSend={() => {}} voice />);
    fireEvent.click(screen.getByRole('button', { name: /voice/i }));
    await waitFor(() => expect(toasts.some((t) => /microphone/i.test(t.message))).toBe(true));
  });
});

/**
 * The @-mention typeahead used to render `role="listbox"` containing `<li>` wrappers around
 * `<button role="option">` — an invalid listbox structure — with nothing tying the textarea
 * to the list. Arrow keys moved a highlight that only sighted users could perceive: no
 * announcement that suggestions had opened, and no way to tell which one was active.
 */
describe('ConversationComposer @-mention typeahead', () => {
  const pool = [
    { id: 'bo', displayName: 'Bo Chen', avatarTint: '#355a74' },
    { id: 'priya', displayName: 'Priya Nair', avatarTint: '#b23a48' },
  ];

  const openTypeahead = () => {
    render(<ConversationComposer onSend={() => {}} mentionPool={pool} />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: '@' } });
    return box;
  };

  it('marks the textarea a combobox that reports the list closed until it opens', () => {
    render(<ConversationComposer onSend={() => {}} mentionPool={pool} />);
    const box = screen.getByRole('combobox');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(box).not.toHaveAttribute('aria-activedescendant');
  });

  it('announces the list as open and points at the active option', () => {
    const box = openTypeahead();
    expect(box).toHaveAttribute('aria-expanded', 'true');

    const active = box.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    // The id must resolve to a real option, or the reference announces nothing.
    const target = document.getElementById(active!);
    expect(target).toHaveAttribute('role', 'option');
    expect(target).toHaveAttribute('aria-selected', 'true');
  });

  it('makes the options direct children of the listbox, with exactly one selected', () => {
    openTypeahead();
    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o.parentElement).toBe(listbox);
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('moves the active option — and the reference to it — with ArrowDown', () => {
    const box = openTypeahead();
    const first = box.getAttribute('aria-activedescendant');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).not.toBe(first);
    expect(document.getElementById(box.getAttribute('aria-activedescendant')!)).toHaveAttribute('aria-selected', 'true');
  });

  /**
   * Escape used to "close" the list by setting the caret to -1. That is not "no caret":
   * `value.slice(0, -1)` is the value minus its last character, so the mention regex ran one
   * character earlier and usually still matched — dismissing `@Bo` re-queried `@B` and the
   * list stayed open, over a caret position that would also have mangled the text had a
   * suggestion then been chosen.
   */
  it('closes on Escape, even when the query still matches a teammate', () => {
    render(<ConversationComposer onSend={() => {}} mentionPool={pool} />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: '@Bo' } });
    expect(box).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('reopens on the next keystroke — Escape dismisses the query, not the feature', () => {
    render(<ConversationComposer onSend={() => {}} mentionPool={pool} />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: '@Bo' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveAttribute('aria-expanded', 'false');

    // A further character of the SAME token — the mention token stops at whitespace, so
    // "@Bo C" is not one query continued but the end of the token followed by loose text.
    fireEvent.change(box, { target: { value: '@Bod' } });
    expect(box).toHaveAttribute('aria-expanded', 'false'); // no teammate matches "Bod"
    fireEvent.change(box, { target: { value: '@Bo' } });
    expect(box).toHaveAttribute('aria-expanded', 'true');
  });

  it('names the listbox, so it is not announced as an unlabelled list', () => {
    openTypeahead();
    expect(screen.getByRole('listbox', { name: 'Mention a teammate' })).toBeInTheDocument();
  });
});

it('stays a plain textbox when there is no mention pool — no phantom combobox', () => {
  render(<ConversationComposer onSend={() => {}} />);
  expect(screen.getByRole('textbox')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).toBeNull();
});

/**
 * `disabled={… || !voice}` rendered a dead "Voice" button in every composer of every team
 * without a transcription provider — a control whose precondition lives in org settings and
 * cannot be read, or changed, from the composer. An unavailable feature is absent.
 */
describe('ConversationComposer voice availability', () => {
  it('offers the control when voice is on', () => {
    render(<ConversationComposer onSend={() => {}} voice />);
    expect(screen.getByRole('button', { name: /Voice/ })).toBeEnabled();
  });

  it('renders no voice control at all when voice is off', () => {
    render(<ConversationComposer onSend={() => {}} />);
    expect(screen.queryByRole('button', { name: /Voice/ })).toBeNull();
  });
});
