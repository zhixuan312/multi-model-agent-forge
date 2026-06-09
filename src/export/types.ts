/**
 * Cross-cutting export types (Spec 8). The data flow is:
 *   collect-artifacts → { meta, sectionHeaders } → template / combined-html
 *   sections → ParsedSection[] → template
 */
import type { ParsedSection } from '@/export/sections';

export type ExportKind = 'exploration' | 'spec' | 'plan' | 'review';

/** Cover meta-row (§1a). Computed by collect-artifacts, rendered by template. */
export interface CoverMeta {
  /** member.display_name of the project owner. */
  owner: string;
  /** Title-cased visibility (`Public` / `Private`). */
  visibility: string;
  /** Count of `component.status='approved'` for the spec stage. */
  componentsApproved: number;
  /** Count of `audit_pass{scope='spec',verdict='clean'}`. */
  auditClean: number;
  /** Display version, e.g. `v1` or `v1 · frozen`. */
  version: string;
}

/** Per-spec-section header data (F1): `NN → {status, roles}`. */
export interface SectionHeader {
  /** Title-cased component.status (e.g. `Approved`, `Gathering`). */
  status: string;
  /** True ⟺ raw status === 'approved' (drives the ✓ approved chip). */
  approved: boolean;
  /** primary_roles joined by ` · ` (empty string ⇒ no chip). */
  roles: string;
}

/** The `NN → SectionHeader` map for a spec artifact. */
export type SectionHeaderMap = Record<string, SectionHeader>;

/** A measured TOC page range for a section. start===end ⇒ `p.N`; else `p.N–M`. */
export interface TocRange {
  startPage: number;
  endPage: number;
}

/** The `NN → TocRange` map produced by the two-pass measure. */
export type TocRanges = Record<string, TocRange>;

/** The full input to the single-artifact HTML template. */
export interface TemplateInput {
  kind: ExportKind;
  projectName: string;
  /** Italic lede (project.summary || project.intent_md || ''). */
  lede: string;
  meta: CoverMeta;
  sections: ParsedSection[];
  /** Spec-only per-section headers (F1). */
  sectionHeaders?: SectionHeaderMap;
  /** Two-pass TOC ranges; undefined on pass 1 (placeholder cells). */
  tocRanges?: TocRanges;
  /** True ⟺ render mermaid as diagrams (else the fence stays a code block). */
  mermaidAsDiagram: boolean;
}
