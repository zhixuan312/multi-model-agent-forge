import { render, screen, fireEvent } from '@testing-library/react';
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
