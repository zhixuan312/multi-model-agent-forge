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

  const onMd = async () => {
    setError(null);
    try {
      await downloadGet(`/api/projects/${projectId}/export/md?artifact=${kind}`, `${kind}.md`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    }
  };

  const onPdf = async () => {
    setError(null);
    try {
      await downloadPost(`/api/projects/${projectId}/export/pdf`, { artifact: kind, mermaidAsDiagram: true }, `${kind}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF export failed.');
    }
  };

  return (
    <div className="flex items-center gap-2" data-testid="stage-export-buttons">
      <button type="button" onClick={onMd} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[11px] font-semibold text-accent">
        .md
      </button>
      <button type="button" onClick={onPdf} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[11px] font-semibold text-accent-deep">
        PDF
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
