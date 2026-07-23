'use client';

import { useState } from 'react';
import { downloadGet, downloadPost } from '@/components/forge/export/download';
import type { ExportKind } from '@/export/types';

export interface StageExportButtonsProps {
  projectId: string;
  kind: ExportKind;
}

export function StageExportButtons({ projectId, kind }: StageExportButtonsProps) {
  const [error, setError] = useState<string | null>(null);
  // A single in-flight export at a time. PDF is a multi-second server Puppeteer render — without a
  // busy guard the buttons stayed enabled and a re-click fired a DUPLICATE export job + a second
  // download (mirrors ExportMenu).
  const [busy, setBusy] = useState(false);

  const onMd = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await downloadGet(`/api/projects/${projectId}/export/md?artifact=${kind}`, `${kind}.md`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const onPdf = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await downloadPost(`/api/projects/${projectId}/export/pdf`, { artifact: kind, mermaidAsDiagram: true }, `${kind}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2" data-testid="stage-export-buttons">
      <button type="button" onClick={onMd} disabled={busy} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[11px] font-semibold text-accent disabled:opacity-50">
        .md
      </button>
      <button type="button" onClick={onPdf} disabled={busy} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[11px] font-semibold text-accent-deep disabled:opacity-50">
        {busy ? 'Exporting…' : 'PDF'}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
