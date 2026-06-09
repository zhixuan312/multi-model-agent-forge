'use client';

import { useState, type FormEvent } from 'react';
import { Markdown } from '@/components/forge/Markdown';
import { cn } from '@/lib/cn';

/**
 * `Composer` (Spec 4 / components/forge — F9/F11) — the per-section Q&A chatbox:
 * the `qa_message` message-log + the answer input.
 *
 * ACCESSIBILITY (F9): the message stream is a `role="log"` live region; the
 * answer textarea is reachable by Tab (it is a native textarea in the tab order);
 * the submit is a labelled button. Focus management on section advance is owned
 * by the parent (it moves focus to the next section's textarea, which carries the
 * supplied `textareaRef`).
 */

export interface QaMessageView {
  id: string;
  sender: 'forge' | 'member';
  bodyMd: string;
}

export interface ComposerProps {
  messages: QaMessageView[];
  onAnswer: (answerMd: string) => void;
  /** Disable input while a turn is in flight or the section is approved. */
  disabled?: boolean;
  busy?: boolean;
  /** Forwarded to the textarea so the parent can move focus here on advance. */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  className?: string;
}

export function Composer({
  messages,
  onAnswer,
  disabled = false,
  busy = false,
  textareaRef,
  className,
}: ComposerProps) {
  const [value, setValue] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed === '' || disabled || busy) return;
    onAnswer(trimmed);
    setValue('');
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        role="log"
        aria-live="polite"
        aria-label="Q&A transcript"
        className="flex flex-col gap-2 overflow-y-auto rounded-[var(--r-md)] border border-line bg-surface p-3"
        data-testid="qa-log"
      >
        {messages.length === 0 ? (
          <p className="text-xs italic text-ink-faint">No questions yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              data-sender={m.sender}
              className={cn(
                'rounded-[var(--r-md)] px-3 py-2 text-sm',
                m.sender === 'forge' ? 'bg-surface-2 text-ink' : 'bg-accent-tint text-accent-deep',
              )}
            >
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {m.sender === 'forge' ? 'Forge' : 'You'}
              </span>
              <Markdown>{m.bodyMd}</Markdown>
            </div>
          ))
        )}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="qa-answer" className="sr-only">
          Your answer
        </label>
        <textarea
          id="qa-answer"
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          rows={3}
          placeholder="Type your answer…"
          className="resize-y rounded-[var(--r-md)] border border-line bg-surface p-2 text-sm text-ink disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || busy || value.trim() === ''}
          className="self-end rounded-[var(--r-md)] bg-accent px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send answer'}
        </button>
      </form>
    </div>
  );
}
