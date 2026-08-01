/**
 * Stage-1 of the PDF pipeline (Spec 8 §"Parse artifact markdown into sections",
 * F2/F5/F13/F21). Splits an artifact `body_md` into page-able sections, extracts
 * mermaid blocks, and converts each section body to SANITIZED HTML.
 *
 * Spec heading contract (F21): `## NN. <Title>` — level-2, zero-padded two-digit
 * number, REQUIRED trailing period. This is now a LEGACY form that nothing emits:
 * mma-spec writes `## <component>` with `### <section>` beneath it, and 0 of the 27
 * spec artifacts on disk are numbered. It is still recognised when present, but the
 * real path for a spec is the generic split below.
 *
 * Zero matches used to be described as a fail-loud contract violation (409 via
 * `SpecHeadingContractError`). No code ever threw it, and enforcing it would have
 * rejected every spec in the product — so the fallback IS the contract, and the
 * error class has been removed rather than wired up.
 *
 * Non-spec artifacts (exploration/plan) split on every level-2 `##` (F5);
 * content before the first `##` is the lead section.
 *
 * HTML sanitization (F13/F20): markdown → HTML runs through unified
 * remark→rehype WITHOUT raw-HTML passthrough (raw HTML is dropped, never
 * executed) + rehype-sanitize as defense-in-depth. `<script>`, `on*` handlers,
 * and remote/`file:` `<img>` therefore never reach the print page.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

export type ParseArtifactKind = 'exploration' | 'spec' | 'plan' | 'journal';

/** A mermaid fenced block extracted from a section (the raw diagram source). */
export interface MermaidBlock {
  source: string;
}

/** One page-able section. */
export interface ParsedSection {
  /** Two-digit `NN` for a spec section; for non-spec, a positional `NN`. */
  nn: string;
  title: string;
  /** Raw markdown of the section body (heading included for re-render fidelity). */
  bodyMd: string;
  /** Sanitized HTML of the section body (heading + content). */
  html: string;
  /** Mermaid blocks found in this section. */
  mermaid: MermaidBlock[];
}

/** The spec heading grammar (F21): `## NN. <Title>`, anchored at line start. */
const SPEC_HEADING_RE = /^##\s+(\d{2})\.\s+(.+?)\s*$/gm;
/** Any level-2 heading (non-spec page-break boundary, F5). */
const H2_RE = /^##\s+(.+?)\s*$/gm;
/** Mermaid fenced block. */
const MERMAID_FENCE_RE = /```mermaid\s*\n([\s\S]*?)```/g;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Sanitized HTML for a markdown fragment (synchronous-friendly via processSync). */
export function markdownToSafeHtml(md: string): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype) // NO allowDangerousHtml — raw HTML dropped (F13)
    .use(rehypeSanitize) // defense-in-depth allow-list (F20)
    .use(rehypeStringify)
    .processSync(md);
  return String(file);
}

/** Extract mermaid blocks from a markdown fragment. */
export function extractMermaid(md: string): MermaidBlock[] {
  const out: MermaidBlock[] = [];
  let m: RegExpExecArray | null;
  MERMAID_FENCE_RE.lastIndex = 0;
  while ((m = MERMAID_FENCE_RE.exec(md)) !== null) {
    out.push({ source: m[1].replace(/\s+$/, '') });
  }
  return out;
}

/** True ⟺ the markdown contains at least one mermaid fence. */
export function hasMermaid(md: string): boolean {
  MERMAID_FENCE_RE.lastIndex = 0;
  return MERMAID_FENCE_RE.test(md);
}

interface RawSection {
  nn: string;
  title: string;
  bodyMd: string;
}

/** Split a spec body on `## NN.` (F21). Returns null if no numbered headings found. */
function splitSpec(bodyMd: string): RawSection[] | null {
  const matches: { nn: string; title: string; start: number; headingEnd: number }[] = [];
  let m: RegExpExecArray | null;
  SPEC_HEADING_RE.lastIndex = 0;
  while ((m = SPEC_HEADING_RE.exec(bodyMd)) !== null) {
    matches.push({
      nn: m[1],
      title: m[2].trim(),
      start: m.index,
      headingEnd: SPEC_HEADING_RE.lastIndex,
    });
  }
  if (matches.length === 0) return null;

  return matches.map((cur, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].start : bodyMd.length;
    return { nn: cur.nn, title: cur.title, bodyMd: bodyMd.slice(cur.start, end).trim() };
  });
}

/** Split a non-spec body on every `##` (F5). Lead content becomes section `00`. */
function splitGeneric(bodyMd: string): RawSection[] {
  const matches: { title: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  H2_RE.lastIndex = 0;
  while ((m = H2_RE.exec(bodyMd)) !== null) {
    matches.push({ title: m[1].trim(), start: m.index });
  }

  const sections: RawSection[] = [];
  // Lead content before the first ## (kept on the page after the cover).
  const firstStart = matches.length > 0 ? matches[0].start : bodyMd.length;
  const lead = bodyMd.slice(0, firstStart).trim();
  if (lead !== '') {
    sections.push({ nn: pad2(sections.length + 1), title: '', bodyMd: lead });
  }
  matches.forEach((cur, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].start : bodyMd.length;
    sections.push({
      nn: pad2(sections.length + 1),
      title: cur.title,
      bodyMd: bodyMd.slice(cur.start, end).trim(),
    });
  });
  // A doc with no `##` and no lead (empty) → one empty group.
  if (sections.length === 0) {
    sections.push({ nn: '01', title: '', bodyMd: bodyMd.trim() });
  }
  return sections;
}

/**
 * Parse an artifact body into page-able, sanitized sections.
 *
 * Never throws on shape. A spec is TRIED as `## NN.` first and falls back to the
 * generic `##` split — which is the path every real spec takes: mma-spec emits
 * `## <component>` with `### <section>` beneath it, not numbered headings (0 of 27
 * spec artifacts on disk use the numbered form). An earlier design failed loud here
 * via `SpecHeadingContractError`; that error was never thrown by any code path, and
 * making it throw would have 409'd every export in the product.
 */
export function parseArtifactSections(
  bodyMd: string,
  kind: ParseArtifactKind,
): ParsedSection[] {
  const raw = kind === 'spec' ? (splitSpec(bodyMd) ?? splitGeneric(bodyMd)) : splitGeneric(bodyMd);

  return raw.map((s) => ({
    nn: s.nn,
    title: s.title,
    bodyMd: s.bodyMd,
    html: markdownToSafeHtml(s.bodyMd),
    mermaid: extractMermaid(s.bodyMd),
  }));
}
