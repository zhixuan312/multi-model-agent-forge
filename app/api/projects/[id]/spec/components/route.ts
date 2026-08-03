import { NextResponse, type NextRequest } from 'next/server';
import { guardProjectRead } from '@/auth/guard-project-write';
import { getDb } from '@/db/client';
import { loadOutline } from '@/spec/spec-core';

export const runtime = 'nodejs';

/**
 * GET the current spec outline components (`ComponentView[]`). The Spec client fetches
 * this directly — after confirming the outline, and as drafts update — INSTEAD of relying
 * on `router.refresh()`. That RSC round-trip races the Outline→Craft phase switch (which
 * mutates the URL via `replaceState`) and can serve a stale 0-component snapshot, leaving
 * a blank "No components yet" view until a hard reload. A direct client fetch (the pattern
 * the Explore stage already uses for its tasks/artifact) lands the fresh data deterministically.
 * Read-only: `loadOutline` derives the components from `project.details`.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const gate = await guardProjectRead(id);
  if (gate instanceof Response) return gate;

  const components = await loadOutline(getDb(), id);
  return NextResponse.json(components);
}
