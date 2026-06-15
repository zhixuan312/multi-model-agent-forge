import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui';

/**
 * Shared "verify" result box — one styling for both the Models tier validation
 * and the Connections validation so they read identically. A tinted bordered box
 * with a verified / not-verified badge (plus an optional extra badge, e.g.
 * "applied"), then children: the detail line and, for Models, the check ladder.
 */
export function VerifyResultBox({
  ok,
  extra,
  children,
}: {
  ok: boolean;
  extra?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-[var(--r-md)] border p-3',
        ok ? 'border-[var(--sage)] bg-sage-tint/30' : 'border-rose/40 bg-rose-tint/20',
      )}
    >
      <div className="flex items-center gap-2">
        <Badge variant={ok ? 'sage' : 'rose'} size="sm">
          {ok ? 'verified' : 'not verified'}
        </Badge>
        {extra}
      </div>
      {children}
    </div>
  );
}
