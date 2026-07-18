'use client';

import { Fragment } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ProseBlock } from '@/components/patterns/prose-block';
import { Avatar } from '@/components/ui';
import { ForgeMark } from '@/components/forge/ForgeMark';
import type { DiscussionMsg, MemberRef } from '@/collab/types';

/**
 * The people-and-AI turns of a section, rendered inline as one continuous chat
 * (no divider): your turns on the right, everyone else — teammates and Forge —
 * on the left. @-mentions in a message are highlighted; a message that mentions
 * teammates went to them (the AI stays out of that turn).
 */
export function DiscussionThread({
  messages,
  memberById,
  currentMemberId,
  mentionPool,
  pending = false,
}: {
  messages: DiscussionMsg[];
  memberById: (id: string) => MemberRef | undefined;
  currentMemberId: string;
  /** Names eligible to be highlighted as @-mentions (the section's participants). */
  mentionPool: MemberRef[];
  /** Forge is composing a reply — appends the thinking bubble. Owned here so Spec, Plan and
   *  Journal stop hand-rolling the same ForgeMark + spinner. */
  pending?: boolean;
}) {
  if (messages.length === 0 && !pending) return null;
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <Bubble
          key={m.id}
          msg={m}
          author={memberById(m.authorId)}
          mine={m.authorId === currentMemberId}
          mentionPool={mentionPool}
        />
      ))}
      {pending ? (
        <div className="flex gap-2.5">
          <ForgeMark className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] text-ink-faint">Forge</span>
            <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
              <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden />
              <span className="text-sm text-ink-soft">Thinking…</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Render body text with any `@Display Name` tokens (for pool members) styled. */
function renderBody(body: string, pool: MemberRef[]): React.ReactNode {
  if (pool.length === 0) return body;
  // Longest names first so "@Bo Chen" wins over "@Bo".
  const names = [...pool].map((m) => m.displayName).sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(?:${escaped.join('|')})`, 'g');
  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) out.push(<Fragment key={`t${i}`}>{body.slice(last, match.index)}</Fragment>);
    out.push(
      <span key={`m${i}`} className="font-semibold text-accent">
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
    i += 1;
  }
  if (last < body.length) out.push(<Fragment key="tail">{body.slice(last)}</Fragment>);
  return out;
}

function Bubble({
  msg,
  author,
  mine,
  mentionPool,
}: {
  msg: DiscussionMsg;
  author: MemberRef | undefined;
  mine: boolean;
  mentionPool: MemberRef[];
}) {
  const isForge = msg.authorId === 'forge';
  const name = isForge ? 'Forge' : mine ? 'You' : (author?.displayName ?? 'Teammate');
  return (
    <div className={cn('flex gap-2.5', mine && 'flex-row-reverse')}>
      {isForge ? (
        <ForgeMark className="mt-0.5 shrink-0" />
      ) : (
        <Avatar size="sm" name={author?.displayName ?? '?'} tint={author?.avatarTint} aria-hidden className="mt-0.5" />
      )}
      <div className={cn('flex min-w-0 max-w-[88%] flex-col', mine && 'items-end')}>
        <span className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
          {name}
          {msg.approval ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-sage-tint px-1.5 py-0.5 text-[10px] font-medium text-[var(--sage-deep)]">
              <Check className="size-2.5" strokeWidth={3} aria-hidden /> approved
            </span>
          ) : null}
        </span>
        <div
          className={cn(
            'rounded-2xl border px-4 py-3 text-sm leading-relaxed text-ink shadow-sm',
            mine ? 'rounded-tr-md border-accent/20 bg-accent-tint' : 'rounded-tl-md border-line bg-surface',
          )}
        >
          {mine ? renderBody(msg.body, mentionPool) : <ProseBlock>{msg.body}</ProseBlock>}
        </div>
      </div>
    </div>
  );
}
