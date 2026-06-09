'use client';

import { useState } from 'react';
import { downloadGet } from '@/components/forge/export/download';
import { ExportPdfDialog } from '@/components/forge/export/ExportPdfDialog';
import type { ExportKind } from '@/export/types';

/**
 * `StageExportButtons` (Spec 8 §In-scope #3a, Key flow E, F12). The per-stage
 * `⭳ Export .md / ▦ Export PDF` pair, scoped to one stage's artifact kind. Hits
 * the SAME `/export/md` + `/export/pdf` routes as the topbar menu (the
 * "same engine" guarantee).
 */
export interface StageExportButtonsProps {
  projectId: string;
  kind: ExportKind;
}

export function StageExportButtons({ projectId, kind }: StageExportButtonsProps) {
  const [pdfOpen, setPdfOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onMd = async () => {
    setError(null);
    try {
      await downloadGet(`/api/projects/${projectId}/export/md?artifact=${kind}`, `${kind}.md`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    }
  };

  return (
    <div className="flex items-center gap-2" data-testid="stage-export-buttons">
      <button
        type="button"
        onClick={onMd}
        className="rounded-[var(--r-md)] border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink"
      >
        <span aria-hidden="true">⭳ </span>Export .md
      </button>
      <button
        type="button"
        onClick={() => setPdfOpen(true)}
        className="rounded-[var(--r-md)] border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink"
      >
        <span aria-hidden="true">▦ </span>Export PDF
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      <ExportPdfDialog projectId={projectId} kind={kind} open={pdfOpen} onClose={() => setPdfOpen(false)} />
    </div>
  );
}
