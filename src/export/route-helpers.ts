/**
 * Shared export route helpers (Spec 8 §UI/routes, F27). Centralizes the
 * artifact-kind validation + the typed-error → HTTP-status mapping every export
 * route shares.
 */
import { NextResponse } from 'next/server';
import { ProjectAccessError } from '@/projects/projects-core';
import { ArtifactNotReadyError } from '@/export/collect-artifacts';
import { SpecHeadingContractError } from '@/export/sections';
import {
  PdfTimeoutError,
  PdfTooLargeError,
  PdfQueueFullError,
  PdfEngineError,
} from '@/export/pdf/render';
import { ExportPathError } from '@/export/export-root';
import { NoComponentsSelectedError, NothingToExportError } from '@/export/service';
import type { ExportKind } from '@/export/types';

const KINDS: ExportKind[] = ['exploration', 'spec', 'plan', 'review'];

/** Validate a caller-supplied artifact kind (F27). `exploration_brief` is rejected. */
export function parseExportKind(raw: unknown): ExportKind | null {
  return typeof raw === 'string' && (KINDS as string[]).includes(raw) ? (raw as ExportKind) : null;
}

/** A 400 for an unknown / out-of-scope artifact kind. */
export function unknownKindResponse(): NextResponse {
  return NextResponse.json({ error: 'unknown_artifact_kind' }, { status: 400 });
}

/**
 * Map a thrown export error to its NextResponse. Returns null when the error is
 * not one of the export-domain errors (caller should rethrow → 500).
 */
export function mapExportError(e: unknown): NextResponse | null {
  if (e instanceof ProjectAccessError) {
    // Export visibility is a 403 (not the read-path 404 anti-enumeration).
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (e instanceof ArtifactNotReadyError) {
    return NextResponse.json({ error: 'artifact_not_ready' }, { status: 409 });
  }
  if (e instanceof SpecHeadingContractError) {
    return NextResponse.json({ error: 'spec_heading_contract_mismatch' }, { status: 409 });
  }
  if (e instanceof NothingToExportError) {
    return NextResponse.json({ error: 'nothing_to_export' }, { status: 409 });
  }
  if (e instanceof NoComponentsSelectedError) {
    return NextResponse.json({ error: 'no_components_selected' }, { status: 422 });
  }
  if (e instanceof PdfTooLargeError) {
    return NextResponse.json({ error: 'export_too_large' }, { status: 413 });
  }
  if (e instanceof PdfQueueFullError) {
    return NextResponse.json({ error: 'pdf_queue_full' }, { status: 503 });
  }
  if (e instanceof PdfTimeoutError) {
    return NextResponse.json({ error: 'pdf_render_timeout' }, { status: 504 });
  }
  if (e instanceof PdfEngineError || e instanceof ExportPathError) {
    return NextResponse.json({ error: 'pdf_engine_unavailable' }, { status: 500 });
  }
  return null;
}
