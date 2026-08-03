import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toasts } = vi.hoisted(() => ({ toasts: [] as Array<{ type: string; message: string }> }));
vi.mock('@/components/ui/toast', () => ({ showToast: (t: { type: string; message: string }) => { toasts.push(t); } }));
import { Message, MessageList, ConversationComposer, ConversationPane, type ConversationMessage } from '@/components/patterns/conversation';

const msgs: ConversationMessage[] = [
  { id: '1', sender: 'forge', bodyMd: 'What is the goal?' },
  { id: '2', sender: 'member', bodyMd: 'Faster checkout.' },
];

describe('Message', () => {
  it('renders forge messages with surface-2 background', () => {
    const { container } = render(<Message msg={msgs[0]} />);
    expect(container.firstElementChild!.className).toContain('bg-surface-2');
  });

  it('renders member messages with accent-tint background', () => {
    const { container } = render(<Message msg={msgs[1]} />);
    expect(container.firstElementChild!.className).toContain('bg-accent-tint');
  });

  it('renders the sender label', () => {
    render(<Message msg={msgs[0]} />);
    expect(screen.getByText('Forge')).toBeInTheDocument();
  });

  it('renders custom sender name', () => {
    render(<Message msg={{ ...msgs[1], senderName: 'Alice' }} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders markdown body', () => {
    render(<Message msg={{ id: '3', sender: 'forge', bodyMd: '**bold**' }} />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });
});

describe('MessageList', () => {
  it('renders as a role="log" aria-live region', () => {
    render(<MessageList messages={msgs} />);
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
  });

  it('renders all messages', () => {
    render(<MessageList messages={msgs} />);
    expect(screen.getByText('What is the goal?')).toBeInTheDocument();
    expect(screen.getByText('Faster checkout.')).toBeInTheDocument();
  });

  it('renders empty state when no messages', () => {
    render(<MessageList messages={[]} emptyText="No messages yet." />);
    expect(screen.getByText('No messages yet.')).toBeInTheDocument();
  });
});

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

describe('ConversationPane', () => {
  it('renders both message list and composer', () => {
    render(<ConversationPane messages={msgs} onSend={() => {}} />);
    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('passes composerProps through', () => {
    render(<ConversationPane messages={msgs} onSend={() => {}} composerProps={{ submitLabel: 'Reply' }} />);
    expect(screen.getByRole('button', { name: /reply/i })).toBeInTheDocument();
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
