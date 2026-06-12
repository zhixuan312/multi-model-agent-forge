/**
 * Hex palette for the Cytoscape network (canvas can't read CSS vars, so the
 * Forge token values are mirrored here as literals — keep in sync with
 * `app/globals.css`). Statuses reuse the journal status colours; edge types get
 * a distinct hue each so the network reads at a glance.
 */

export const STATUS_HEX: Record<string, string> = {
  adopted: '#4e7350', // sage
  superseded: '#a9761a', // amber
  inconclusive: '#355a74', // steel
  dropped: '#b23a48', // rose
};
const STATUS_FALLBACK = '#938979'; // ink-faint

export function statusHex(status: string): string {
  return STATUS_HEX[status] ?? STATUS_FALLBACK;
}

export const EDGE_HEX: Record<string, string> = {
  supersedes: '#a9761a', // amber — replacement
  refines: '#c4521e', // ember — sharpening
  relates: '#938979', // ink-faint — loose link
  'depends-on': '#355a74', // steel — dependency
  contradicts: '#b23a48', // rose — conflict
  parent: '#5c5347', // ink-soft — hierarchy
};
const EDGE_FALLBACK = '#938979';

export function edgeHex(type: string): string {
  return EDGE_HEX[type] ?? EDGE_FALLBACK;
}
