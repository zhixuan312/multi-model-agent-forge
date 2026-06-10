'use client';

import { useId } from 'react';
import { Input, Label, Micro } from '@/components/ui';

export interface ModelSuggestion {
  provider: string;
  prefix: string;
  bestFor: string | null;
}

/**
 * Model combobox (Spec 2 §Flow C / F26): a free-text input backed by a native
 * `<datalist>` of profiled prefixes. Because catalog prefixes are FAMILIES, not
 * concrete deployable ids, the field accepts any typed model id (custom allowed)
 * while suggesting the profiled prefixes — arrow-key navigation + type-ahead are
 * provided by the browser's datalist. Degrades to plain free-text when the
 * catalog is unavailable (`available=false` → no suggestions).
 *
 * Accessibility: a programmatic `<label>`, a visible focus ring, and a
 * `list`-associated combobox role from the native datalist binding.
 */
export function ModelCombobox({
  id,
  label,
  value,
  onChange,
  suggestions,
  catalogAvailable,
  describedById,
}: {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (next: string) => void;
  suggestions: ModelSuggestion[];
  catalogAvailable: boolean;
  describedById?: string;
}) {
  const listId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}{' '}
        <span className="font-normal text-ink-faint">
          · {catalogAvailable ? 'pick a profiled family or type a custom id' : 'type a model id'}
        </span>
      </Label>
      <Input
        id={id}
        role="combobox"
        aria-expanded="false"
        aria-autocomplete="list"
        list={suggestions.length > 0 ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. claude-opus-4-8"
        className="font-mono"
        aria-describedby={describedById}
      />
      {suggestions.length > 0 ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={`${s.provider}:${s.prefix}`} value={s.prefix}>
              {s.bestFor ? `${s.provider} — ${s.bestFor}` : s.provider}
            </option>
          ))}
        </datalist>
      ) : null}
      {!catalogAvailable ? <Micro>Model catalog unavailable — enter a model id manually.</Micro> : null}
    </div>
  );
}
