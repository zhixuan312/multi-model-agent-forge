/**
 * The tier vocabulary — the shape of a tier and the three of them, in display order.
 *
 * SEPARATE from `mma-config-reader.ts` because that module opens `~/.mma/config.json` and so
 * imports `node:fs`/`node:os`/`node:path`. `ModelsPanel` is a `'use client'` component and
 * needs `TIERS`; importing the value from the reader pulled Node's fs into the browser bundle
 * and broke `next build` outright:
 *
 *     the chunking context (unknown) does not support external modules (request: node:fs)
 *
 * Nothing else caught it. The TYPES had always been imported from there safely — `import type`
 * is erased — so tsc, eslint and the whole vitest suite stayed green, and the dev server
 * chunks differently and served it fine. Only a production build fails.
 *
 * Anything a client component needs from the tier vocabulary belongs here. The reader keeps
 * what it alone can do: read the file.
 */
/**
 * The tiers, in display order — one list, one order, for the reader, the panel, the
 * configure-provider request and its API route alike.
 *
 * The array is the source and the type derives from it (the `db/enums.ts` pattern), so a
 * Zod schema can be `z.enum(TIERS)` rather than a fourth hand-written spelling. There were
 * three: this, `configure-provider.ts`'s `AgentTier`, and the route's inline
 * `z.enum(['main', 'complex', 'standard'])`.
 */
export const TIERS = ['main', 'complex', 'standard'] as const;

export type TierKey = (typeof TIERS)[number];

export interface TierConfig {
  dialect: string;
  model: string;
  baseUrl: string | null;
  authMode: 'oauth' | 'api-key';
}

export type MmaTiers = Record<TierKey, TierConfig | null>;


/**
 * The model used when the `main` tier carries no explicit model. MMA requires
 * `X-MMA-Main-Model` on every route (400 `main_model_required` otherwise), so a dispatch
 * made before anyone visits the Models tab still needs a value.
 */
export const DEFAULT_MAIN_MODEL = 'claude-opus-4-8';
