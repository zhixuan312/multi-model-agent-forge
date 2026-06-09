import { render, screen, fireEvent } from '@testing-library/react';
import { Composer, type QaMessageView } from '@/components/forge/Composer';

const messages: QaMessageView[] = [
  { id: '1', sender: 'forge', bodyMd: 'What is the goal?' },
  { id: '2', sender: 'member', bodyMd: 'Faster checkout.' },
];

describe('Composer (Q&A chatbox)', () => {
  it('renders the message stream as a role="log" live region (F9)', () => {
    render(<Composer messages={messages} onAnswer={() => {}} />);
    const log = screen.getByRole('log');
    expect(log).toBeInTheDocument();
    expect(log).toHaveAttribute('aria-live', 'polite');
  });

  it('the answer textarea is reachable by Tab (in the tab order) (F9)', () => {
    render(<Composer messages={messages} onAnswer={() => {}} />);
    const textarea = screen.getByLabelText('Your answer');
    // A native, non-disabled textarea is in the tab order (tabIndex not -1).
    expect(textarea.tabIndex).not.toBe(-1);
  });

  it('submits the trimmed answer and clears the input', () => {
    const onAnswer = vi.fn();
    render(<Composer messages={messages} onAnswer={onAnswer} />);
    const textarea = screen.getByLabelText('Your answer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  My answer.  ' } });
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));
    expect(onAnswer).toHaveBeenCalledWith('My answer.');
    expect(textarea.value).toBe('');
  });

  it('does not submit an empty answer', () => {
    const onAnswer = vi.fn();
    render(<Composer messages={[]} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
