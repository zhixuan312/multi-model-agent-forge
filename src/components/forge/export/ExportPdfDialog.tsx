'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { downloadPost } from '@/components/forge/export/download';
import type { ExportKind } from '@/export/types';

/**
 * `ExportPdfDialog` (Spec 8 §In-scope #3, Key flow C, F5/F13/F30). PDF options:
 * for a spec, an include-component checkbox per `{NN,title}` (value=NN,
 * label=title) fetched from `/export/sections`; for other kinds, just the
 * Mermaid-as-diagram toggle. The `Export PDF` button is disabled when zero
 * components are checked (client guard for the server 422). No preview thumbnail
 * (out of scope v1, F5).
 *
 * a11y: native checkboxes labelled by their section title; ESC closes; focus
 * is on the dialog. (No Radix in this codebase — semantic HTML + ARIA.)
 */
export interface ExportPdfDialogProps {
  projectId: string;
  kind: ExportKind;
  open: boolean;
  onClose: () => void;
  /** Injectable for tests; defaults to fetch. */
  fetchSections?: (projectId: string) => Promise<{ nn: string; title: string }[]>;
}

async function defaultFetchSections(projectId: string): Promise<{ nn: string; title: string }[]> {
  try {
    const res = await fetch(`/api/projects/${projectId}/export/sections?artifact=spec`);
    if (!res.ok) return [];
    const data = (await res.json()) as { sections: { nn: string; title: string }[] };
    return data.sections;
  } catch {
    return [];
  }
}

export function ExportPdfDialog({
  projectId,
  kind,
  open,
  onClose,
  fetchSections = defaultFetchSections,
}: ExportPdfDialogProps) {
  const isSpec = kind === 'spec';
  const [sections, setSections] = useState<{ nn: string; title: string }[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mermaid, setMermaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !isSpec) return;
    let alive = true;
    void fetchSections(projectId).then((secs) => {
      if (!alive) return;
      setSections(secs);
      setChecked(new Set(secs.map((s) => s.nn))); // all checked by default
    });
    return () => {
      alive = false;
    };
  }, [open, isSpec, projectId, fetchSections]);

  if (!open) return null;

  const toggle = (nn: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(nn)) next.delete(nn);
      else next.add(nn);
      return next;
    });
  };

  const zeroSelected = isSpec && checked.size === 0;

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadPost(
        `/api/projects/${projectId}/export/pdf`,
        {
          artifact: kind,
          includeComponents: isSpec ? [...checked] : undefined,
          mermaidAsDiagram: mermaid,
        },
        `${kind}.pdf`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Export ${kind} as PDF`}
      data-testid="export-pdf-dialog"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-[var(--r-lg)] border border-line bg-surface p-5 shadow-xl">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-faint">
          PDF · {kind === 'spec' ? 'Specification' : kind}
        </div>

        {isSpec ? (
          <>
            <div className="mb-2 text-xs font-semibold text-ink-soft">Include components</div>
            <div className="flex flex-col gap-1.5" data-testid="component-list">
              {sections.map((s) => (
                <label key={s.nn} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    value={s.nn}
                    checked={checked.has(s.nn)}
                    onChange={() => toggle(s.nn)}
                    aria-label={s.title}
                  />
                  {s.title}
                </label>
              ))}
            </div>
          </>
        ) : null}

        <label className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={mermaid}
            onChange={(e) => setMermaid(e.target.checked)}
            aria-label="Mermaid flow charts as diagrams"
          />
          Mermaid flow charts as diagrams
        </label>

        {error ? <div className="mt-3 text-xs text-red-600">{error}</div> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[var(--r-md)] px-3 py-1.5 text-sm text-ink-soft">
            Cancel
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={zeroSelected || busy}
            aria-disabled={zeroSelected || busy}
            className={cn(
              'rounded-[var(--r-md)] bg-accent px-4 py-1.5 text-sm font-medium text-white',
              (zeroSelected || busy) && 'cursor-not-allowed opacity-50',
            )}
          >
            <span aria-hidden="true">⭳ </span>Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}
