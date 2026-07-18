'use client';

import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';

/**
 * SearchInput — the canonical search control inside a `Toolbar`. Owns the whole
 * convention so it cannot drift: a leading search glyph, `type="search"`, and a
 * placeholder + accessible name derived from one `label` noun ("Search repos…"
 * / "Search repos"). Grows to fill the toolbar's free space by default; pass
 * `className="flex-none"` when it sits in a row of pills that should stay put.
 *
 *   <Toolbar>
 *     <SearchInput label="members" value={q} onChange={setQ} />
 *     <Select>…</Select>
 *   </Toolbar>
 */
export interface SearchInputProps {
  /** Plural noun for the placeholder + accessible name, e.g. `members` → "Search members…". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SearchInput({ label, value, onChange, className }: SearchInputProps) {
  return (
    <div className={cn('relative min-w-[220px] flex-1', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
      <Input
        type="search"
        aria-label={`Search ${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Search ${label}…`}
        className="pl-9"
      />
    </div>
  );
}
