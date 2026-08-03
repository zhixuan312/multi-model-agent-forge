import { type EdgeType, type JournalStatus } from '@/journal/types';

/**
 * Hex palette for the graph canvas. Canvas cannot read CSS custom properties, so the Forge
 * token VALUES are mirrored here as literals.
 *
 * The trailing comment on each entry names the token it mirrors, and
 * `tests/distribution/design-tokens.test.ts` PARSES those comments and resolves each token in
 * `app/globals.css` — so the annotations are the assertion, not decoration. Keep the
 * `'#hex', // token-name` shape (no `--` prefix); that is what the ratchet reads.
 *
 * Both maps are TOTAL over their enum (`satisfies`), so a new status or edge type fails the
 * build here instead of silently falling back to grey — which is what a `Record<string,
 * string>` allowed. The fallback stays for values off the disk that are outside the taxonomy:
 * a node's frontmatter is arbitrary text, so an unknown status is a real input, not a bug.
 */
export const STATUS_HEX = {
  adopted: '#4e7350', // sage
  superseded: '#a9761a', // amber
  inconclusive: '#355a74', // steel
  dropped: '#b23a48', // rose
} as const satisfies Record<JournalStatus, string>;

/** Used for a status or edge type outside the taxonomy. */
const NEUTRAL_HEX = '#938979'; // warm-ink-faint

export function statusHex(status: string): string {
  return STATUS_HEX[status as JournalStatus] ?? NEUTRAL_HEX;
}

export const EDGE_HEX = {
  supersedes: '#a9761a', // amber — replacement
  refines: '#c4521e', // ember — sharpening
  relates: '#938979', // warm-ink-faint — loose link
  'depends-on': '#355a74', // steel — dependency
  contradicts: '#b23a48', // rose — conflict
  parent: '#5c5347', // warm-ink-soft — hierarchy
} as const satisfies Record<EdgeType, string>;

export function edgeHex(type: string): string {
  return EDGE_HEX[type as EdgeType] ?? NEUTRAL_HEX;
}
