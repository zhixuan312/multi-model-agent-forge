'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, Search, FileText, ClipboardList, BookOpen, Boxes, type LucideIcon } from 'lucide-react';
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
  lockedAudited: boolean;
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
  journal: BookOpen,
};

async function defaultFetchArtifacts(projectId: string): Promise<ExportMenuArtifact[]> {
  const res = await fetch(`/api/projects/${projectId}/export/artifacts`);
  // Throw (don't silently return []) so a load failure surfaces a message instead of an
  // unexplained empty menu (e.g. a 403 on a project you can view but can't collaborate on).
  if (!res.ok) throw new Error('Couldn’t load exportable artifacts.');
  const data = (await res.json()) as { artifacts: ExportMenuArtifact[] };
  return data.artifacts;
}

export function ExportMenu({ projectId, fetchArtifacts = defaultFetchArtifacts, onToast }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<ExportMenuArtifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A single in-flight export at a time — PDF/bundle are multi-second (server Puppeteer), so
  // without this the buttons stayed enabled and a re-click fired a duplicate export job.
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    void fetchArtifacts(projectId)
      .then((a) => { if (alive) setArtifacts(a); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Couldn’t load exportable artifacts.'); });
    return () => {
      alive = false;
    };
  }, [open, projectId, fetchArtifacts]);

  const onMd = async (kind: ExportKind) => {
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

  const onPdf = async (kind: ExportKind) => {
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

  const onBundle = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const { included } = await downloadPost(`/api/projects/${projectId}/export/bundle`, {}, 'bundle.zip');
      const names = (included ?? []).map((k) =>
        k === 'spec' ? 'specification' : k === 'review' ? 'review' : k,
      );
      onToast?.(`Bundle ready — ${names.join(', ')}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bundle failed.');
    } finally {
      setBusy(false);
    }
  };

  function badge(a: ExportMenuArtifact) {
    if (!a.ready) return <Badge size="sm">pending</Badge>;
    if (a.lockedAudited)
      return (
        <Badge variant="sage" size="sm" dot>
          locked · audited
        </Badge>
      );
    return (
      <Badge variant="sage" size="sm" dot>
        ready
      </Badge>
    );
  }

  return (
    <div ref={menuRef} className="relative" data-testid="export-menu-root">
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
                  disabled={!a.ready || busy}
                  aria-disabled={!a.ready || busy}
                  onClick={() => void onMd(a.kind)}
                  className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[11.5px] font-semibold text-accent disabled:opacity-50"
                >
                  .md
                </button>
                <button
                  type="button"
                  disabled={!a.ready || busy}
                  aria-disabled={!a.ready || busy}
                  onClick={() => void onPdf(a.kind)}
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
              disabled={busy}
              aria-disabled={busy}
              onClick={() => void onBundle()}
              className="flex w-full items-center gap-3 rounded-[var(--r-md)] border border-accent-tint bg-accent-tint px-3 py-3 text-left disabled:opacity-50"
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
