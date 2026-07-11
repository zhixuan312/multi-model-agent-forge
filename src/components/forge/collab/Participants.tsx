'use client';

import { Check, UserPlus } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Avatar,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui';
import type { MemberRef, Participant } from '@/collab/types';

/**
 * Collaborative-approval surfaces for a co-approved unit (Spec component):
 * - `ParticipantStrip` — the detailed header row where work happens (avatars +
 *   approve state + an "Invite" picker).
 * - `ApproverCluster` — the glanceable cluster the right panel uses to answer
 *   "who else hasn't approved?" at a glance.
 * Both read the same `Participant[]`; ≥1 approval is good-to-go, the rest are
 * shown for visibility (never a hard block).
 */

/** One avatar with an approval check (approved) or dimmed ring (pending). */
export function ParticipantAvatar({
  p,
  size = 'sm',
}: {
  p: Participant;
  size?: 'sm' | 'md';
}) {
  const approved = p.approvedAt !== null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative inline-flex">
          <Avatar
            size={size}
            name={p.member.displayName}
            tint={p.member.avatarTint}
            className={cn('ring-2 ring-surface', !approved && 'opacity-55')}
          />
          {approved ? (
            <span className="absolute -bottom-0.5 -right-0.5 grid size-3 place-items-center rounded-full bg-[var(--sage)] ring-2 ring-surface">
              <Check className="size-2 text-white" strokeWidth={3.5} aria-hidden />
            </span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {p.member.displayName} — {approved ? 'approved' : 'not yet approved'}
      </TooltipContent>
    </Tooltip>
  );
}

/** The member picker used by "Invite" — lists the pool minus current participants. */
function InviteMenu({
  pool,
  participants,
  onAdd,
  disabled,
}: {
  pool: MemberRef[];
  participants: Participant[];
  onAdd: (m: MemberRef) => void;
  disabled?: boolean;
}) {
  const here = new Set(participants.map((p) => p.member.id));
  const candidates = pool.filter((m) => !here.has(m.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || candidates.length === 0}
        className={cn(
          'focus-ring inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] font-medium text-ink-soft transition-colors',
          'hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-50',
        )}
      >
        <UserPlus className="size-3" aria-hidden /> Invite
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Pull a teammate in</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {candidates.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => onAdd(m)}>
            <Avatar size="sm" name={m.displayName} tint={m.avatarTint} aria-hidden />
            {m.displayName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Header strip: participants + approve state + invite. Empty until someone's on. */
export function ParticipantStrip({
  participants,
  pool,
  onAdd,
  disabled,
}: {
  participants: Participant[];
  pool: MemberRef[];
  onAdd: (m: MemberRef) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Approvers
      </span>
      {participants.length > 0 ? (
        <div className="flex items-center gap-1.5">
          {participants.map((p) => (
            <ParticipantAvatar key={p.member.id} p={p} />
          ))}
        </div>
      ) : (
        <span className="text-xs text-ink-faint">Just you — invite teammates to co-approve.</span>
      )}
      {null}
      <span className="flex-1" />
      <InviteMenu pool={pool} participants={participants} onAdd={onAdd} disabled={disabled} />
    </div>
  );
}

/** Compact overlapping cluster for the right-panel rows (glanceable). */
export function ApproverCluster({ participants }: { participants: Participant[] }) {
  if (participants.length === 0) return null;
  const max = 4;
  const shown = participants.slice(0, max);
  const extra = participants.length - shown.length;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="flex items-center">
        {shown.map((p, i) => (
          <span key={p.member.id} style={{ marginLeft: i === 0 ? 0 : -7 }}>
            <ParticipantAvatar p={p} />
          </span>
        ))}
        {extra > 0 ? (
          <span
            className="inline-grid size-6 place-items-center rounded-full bg-surface-2 text-[0.625rem] font-semibold text-ink-soft ring-2 ring-surface"
            style={{ marginLeft: -7 }}
          >
            +{extra}
          </span>
        ) : null}
      </span>
      {null}
    </span>
  );
}
