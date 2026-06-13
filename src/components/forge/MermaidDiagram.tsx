'use client';

import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * `MermaidDiagram` — best-effort client rendering of a ```mermaid fence, layered
 * on top of the inert baseline in `Markdown` (F14). Mermaid runs with
 * `securityLevel: 'strict'` (no scripts, no click handlers) and produces a
 * sanitized SVG, so injecting that SVG is safe. Until the diagram renders — and
 * on any parse error — it falls back to the same inert, escaped code block the
 * hardened baseline shows, so untrusted input can never execute.
 */
const BOX = 'overflow-x-auto rounded-[var(--r-md)] border border-line bg-surface-2 p-3';

export function MermaidDiagram({ source, className }: { source: string; className?: string }) {
  const safeId = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
          fontFamily: 'inherit',
        });
        const { svg: rendered } = await mermaid.render(safeId, source);
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, safeId]);

  if (failed || svg === null) {
    return (
      <pre data-mermaid data-security-level="strict" className={cn(BOX, 'text-xs', className)}>
        <code>{source}</code>
      </pre>
    );
  }

  return (
    <div
      data-mermaid-rendered
      className={cn(BOX, '[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full', className)}
      // Sanitized by mermaid's strict securityLevel — no executable content.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
