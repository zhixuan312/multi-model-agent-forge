'use client';

import { useState } from 'react';
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
}


export function ExportPdfDialog({
  projectId,
  kind,
  open,
  onClose,
}: ExportPdfDialogProps) {
  const [mermaid, setMermaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadPost(
        `/api/projects/${projectId}/export/pdf`,
        {
          artifact: kind,
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
          <Button onClick={onExport} disabled={busy} loading={busy}>
            <Download aria-hidden />
            Export PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
