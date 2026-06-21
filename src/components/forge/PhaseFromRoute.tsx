'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import type { ReactNode } from 'react';

const DESIGN_SEGMENTS = new Set(['explore', 'spec', 'plan', 'freeze']);
const BUILD_SEGMENTS = new Set(['execute', 'build', 'review']);

export function PhaseFromRoute({ fallback, children }: { fallback: 'design' | 'build'; children: ReactNode }) {
  const seg = useSelectedLayoutSegment();
  const phase = seg && DESIGN_SEGMENTS.has(seg) ? 'design'
    : seg && BUILD_SEGMENTS.has(seg) ? 'build'
    : fallback;
  return <div data-phase={phase} className="contents">{children}</div>;
}
