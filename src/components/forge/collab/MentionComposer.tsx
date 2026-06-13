'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar, Button, Textarea } from '@/components/ui';
import type { MemberRef } from '@/collab/types';

/**
 * A textarea with `@`-mention autocomplete over the people ALREADY in the chat
 * (the section's participants — pulled in via the top "Invite"). Typing `@` opens
 * a picker of those teammates; choosing one inserts `@Display Name`. `@`-mentioning
 * directs the message at those people (the parent keeps the AI out of that turn);
 * with no `@`, the message goes to Forge. Enter submits, Shift+Enter newlines,
 * and Enter accepts the highlighted suggestion while the picker is open.
 */
export function MentionComposer({
  value,
  onChange,
  onSubmit,
  pool,
  disabled,
  placeholder,
  submitLabel = 'Send',
  secondary,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** Teammates eligible to be @-mentioned — the section's current participants. */
  pool: MemberRef[];
  disabled?: boolean;
  placeholder?: string;
  submitLabel?: string;
  /** Optional action rendered left of the submit button (e.g. "Construct section"). */
  secondary?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);

  // The in-progress @-token immediately left of the caret (null when none).
  const query = useMemo(() => {
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\d.'-]*)$/u);
    return m ? m[1]! : null;
  }, [value, caret]);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return pool.filter((m) => m.displayName.toLowerCase().includes(q)).slice(0, 6);
  }, [query, pool]);

  const open = matches.length > 0;

  function syncCaret(): void {
    setCaret(ref.current?.selectionStart ?? value.length);
  }

  function choose(m: MemberRef): void {
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const replaced = before.replace(/@([\p{L}\d.'-]*)$/u, `@${m.displayName} `);
    onChange(replaced + after);
    setActive(0);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const pos = replaced.length;
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(matches[active] ?? matches[0]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCaret(-1); // collapse the menu without losing text
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSubmit();
    }
  }

  return (
    <div className="relative">
      {open ? (
        <ul
          role="listbox"
          aria-label="Mention a teammate in the chat"
          className="forge-pop absolute bottom-full z-50 mb-1.5 max-h-56 w-64 overflow-y-auto rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          {matches.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep textarea focus
                  choose(m);
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-1.5 text-left text-sm transition-colors',
                  i === active ? 'bg-surface-2 text-ink' : 'text-ink-soft',
                )}
              >
                <Avatar size="sm" name={m.displayName} tint={m.avatarTint} aria-hidden />
                <span className="truncate">{m.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onSelect={syncCaret}
        rows={2}
        disabled={disabled}
        placeholder={placeholder}
        className="!min-h-0 !rounded-2xl !text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {secondary}
        <span className="flex-1" />
        <Button size="sm" onClick={onSubmit} disabled={disabled || !value.trim()} rightIcon={<ArrowRight />}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
