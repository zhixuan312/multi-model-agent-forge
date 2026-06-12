'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  Checkbox,
  Button,
  Label,
  Micro,
} from '@/components/ui';
import { downloadPost } from '@/components/forge/export/download';
import type { ExportKind } from '@/export/types';

/**
 * `ExportPdfDialog` (Spec 8 §In-scope #3, Key flow C, F5/F13/F30). PDF options:
 * for a spec, an include-component `Checkbox` per `{NN,title}` fetched from
 * `/export/sections`; for other kinds, just the Mermaid-as-diagram toggle. The
 * `Export PDF` button is disabled when zero components are checked (client guard
 * for the server 422). No preview thumbnail (out of scope v1, F5).
 *
 * Built on the canonical Radix `Dialog` + `Checkbox` (portal, focus trap, Escape,
 * aria wiring handled by the framework).
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="export-pdf-dialog" aria-label={`Export ${kind} as PDF`} className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono !text-xs font-bold uppercase tracking-wider text-ink-faint">
            PDF · {kind === 'spec' ? 'Specification' : kind}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose what to include in the exported {kind} PDF.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {isSpec ? (
            <div className="flex flex-col gap-2">
              <Label as="div" className="text-ink-soft">
                Include components
              </Label>
              <div className="flex flex-col gap-1.5" data-testid="component-list">
                {sections.map((s) => {
                  const id = `pdf-sec-${s.nn}`;
                  return (
                    <div key={s.nn} className="flex items-center gap-2.5">
                      <Checkbox id={id} checked={checked.has(s.nn)} onCheckedChange={() => toggle(s.nn)} />
                      <label htmlFor={id} className="cursor-pointer text-sm text-ink-soft">
                        {s.title}
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2.5">
            <Checkbox id="pdf-mermaid" checked={mermaid} onCheckedChange={(v) => setMermaid(v === true)} />
            <label htmlFor="pdf-mermaid" className="cursor-pointer text-sm text-ink-soft">
              Mermaid flow charts as diagrams
            </label>
          </div>

          {error ? (
            <Micro role="alert" className="block text-rose">
              {error}
            </Micro>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onExport} disabled={zeroSelected || busy} loading={busy}>
            <Download aria-hidden />
            Export PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
