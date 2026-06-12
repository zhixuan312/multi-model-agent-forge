import { cn } from '@/lib/cn';
import { Avatar, type AvatarProps } from '@/components/ui/avatar';

/**
 * AvatarGroup — overlapping member avatars with a `+N` overflow chip. Each
 * avatar gets a surface ring so the stack reads cleanly. Used in the work-queue
 * card's meta line (owner + collaborators) and anywhere presence is shown.
 */
export interface AvatarGroupMember {
  name: string;
  tint?: string;
}

export function AvatarGroup({
  members,
  max = 3,
  size = 'sm',
  className,
}: {
  members: AvatarGroupMember[];
  /** Max avatars shown before collapsing to `+N`. */
  max?: number;
  size?: AvatarProps['size'];
  className?: string;
}) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  return (
    <div className={cn('flex items-center', className)}>
      {shown.map((m, i) => (
        <Avatar
          key={i}
          size={size}
          name={m.name}
          tint={m.tint}
          aria-hidden
          className="ring-2 ring-surface"
          style={{ marginLeft: i === 0 ? 0 : -7 }}
        />
      ))}
      {extra > 0 ? (
        <span
          className="inline-grid size-6 place-items-center rounded-full bg-surface-2 text-[0.625rem] font-semibold text-ink-soft ring-2 ring-surface"
          style={{ marginLeft: -7 }}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
