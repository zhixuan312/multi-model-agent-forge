'use client';

import { useEffect, useState } from 'react';
import { Download, ChevronDown, Search, FileText, ClipboardList, ScanEye, Boxes, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Badge, TextSm, Micro } from '@/components/ui';
import { downloadGet, downloadPost } from '@/components/forge/export/download';
import type { ExportKind } from '@/export/types';

/**
 * `ExportMenu` (Spec 8 §In-scope #2, Key flow A, F4/F10). The topbar `Export ▾`
 * dropdown: one row per deliverable kind (icon + label + ready/pending badge +
 * `.md`/`PDF` actions), pending rows dimmed + disabled, then the
 * `Export everything → Bundle` row. Matches `export.html`.
 *
 * a11y: a real menu (button toggles a labelled region); pending rows carry
 * `aria-disabled`. (No Radix in this codebase — semantic HTML + ARIA.)
 */
export interface ExportMenuArtifact {
  kind: ExportKind;
  label: string;
  ready: boolean;
  version: number | null;
  frozenAudited: boolean;
}

export interface ExportMenuProps {
  projectId: string;
  /** Injectable for tests; defaults to fetch /export/artifacts. */
  fetchArtifacts?: (projectId: string) => Promise<ExportMenuArtifact[]>;
  /** Injectable toast/announce sink (tests assert the bundle enumeration). */
  onToast?: (message: string) => void;
}

const ICON: Record<ExportKind, LucideIcon> = {
  exploration: Search,
  spec: FileText,
  plan: ClipboardList,
  review: ScanEye,
};

async function defaultFetchArtifacts(projectId: string): Promise<ExportMenuArtifact[]> {
  const res = await fetch(`/api/projects/${projectId}/export/artifacts`);
  if (!res.ok) return [];
  const data = (await res.json()) as { artifacts: ExportMenuArtifact[] };
  return data.artifacts;
}

export function ExportMenu({ projectId, fetchArtifacts = defaultFetchArtifacts, onToast }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<ExportMenuArtifact[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetchArtifacts(projectId).then((a) => {
      if (alive) setArtifacts(a);
    });
    return () => {
      alive = false;
    };
  }, [open, projectId, fetchArtifacts]);

  const onMd = async (kind: ExportKind) => {
    setError(null);
    try {
      await downloadGet(`/api/projects/${projectId}/export/md?artifact=${kind}`, `${kind}.md`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    }
  };

  const onBundle = async () => {
    setError(null);
    try {
      const { included } = await downloadPost(`/api/projects/${projectId}/export/bundle`, {}, 'bundle.zip');
      const names = (included ?? []).map((k) =>
        k === 'spec' ? 'specification' : k === 'review' ? 'review' : k,
      );
      onToast?.(`Bundle ready — ${names.join(', ')}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bundle failed.');
    }
  };

  function badge(a: ExportMenuArtifact) {
    if (!a.ready) return <Badge size="sm">pending</Badge>;
    if (a.frozenAudited)
      return (
        <Badge variant="sage" size="sm" dot>
          frozen · audited
        </Badge>
      );
    return (
      <Badge variant="sage" size="sm" dot>
        ready
      </Badge>
    );
  }

  return (
    <div className="relative" data-testid="export-menu-root">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        leftIcon={<Download />}
        rightIcon={<ChevronDown />}
      >
        Export
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label="Export artifacts"
          data-testid="export-menu"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-xl"
        >
          <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-3">
            <Download className="size-4 text-accent" aria-hidden />
            <TextSm className="!font-semibold !text-ink">Export</TextSm>
          </div>
          <div className="p-2">
            {artifacts.map((a) => {
              const Icon = ICON[a.kind];
              return (
              <div
                key={a.kind}
                data-testid={`export-row-${a.kind}`}
                aria-disabled={!a.ready}
                className={cn('flex items-center gap-3 rounded-[var(--r-md)] px-3 py-2.5', !a.ready && 'opacity-[.55]')}
              >
                <span
                  aria-hidden="true"
                  className="grid h-7 w-7 place-items-center rounded-[var(--r-md)] bg-accent-tint text-accent [&_svg]:size-4"
                >
                  <Icon />
                </span>
                <div className="flex flex-1 flex-col items-start gap-1">
                  <TextSm className="!font-semibold !text-ink">{a.label}</TextSm>
                  {badge(a)}
                </div>
                <button
                  type="button"
                  disabled={!a.ready}
                  aria-disabled={!a.ready}
                  onClick={() => onMd(a.kind)}
                  className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[11.5px] font-semibold text-accent disabled:opacity-50"
                >
                  .md
                </button>
                <button
                  type="button"
                  disabled={!a.ready}
                  aria-disabled={!a.ready}
                  onClick={() => {
                    setError(null);
                    downloadPost(`/api/projects/${projectId}/export/pdf`, { artifact: a.kind, mermaidAsDiagram: true }, `${a.kind}.pdf`)
                      .catch((e) => setError(e instanceof Error ? e.message : 'PDF export failed.'));
                  }}
                  className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[11.5px] font-semibold text-accent-deep disabled:opacity-50"
                >
                  PDF
                </button>
              </div>
              );
            })}

            <div className="my-1.5 h-px bg-line" />

            <button
              type="button"
              data-testid="export-bundle"
              onClick={onBundle}
              className="flex w-full items-center gap-3 rounded-[var(--r-md)] border border-accent-tint bg-accent-tint px-3 py-3 text-left"
            >
              <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-[var(--r-md)] bg-accent text-white [&_svg]:size-4">
                <Boxes />
              </span>
              <div className="flex flex-1 flex-col items-start">
                <TextSm className="!font-semibold !text-ink">Export everything</TextSm>
                <Micro>.zip — all .md + one combined PDF</Micro>
              </div>
              <span className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white">Bundle</span>
            </button>
          </div>
          {error ? <TextSm className="block px-4 pb-3 !text-xs !text-rose">{error}</TextSm> : null}
        </div>
      ) : null}

    </div>
  );
}
