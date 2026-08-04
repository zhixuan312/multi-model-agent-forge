/**
 * Types for mma's `POST /configure-provider` endpoint. mma OWNS the
 * validate ladder + the runtime in-memory hot-swap; Forge only calls it
 * (Validate = dryRun:true, Apply = dryRun:false). Shapes mirror the current
 * contract (response field `verified`) — see src/mma/COMPATIBILITY.md.
 */
import type { TierKey } from '@/mma/tiers';

/**
 * The two WIRE PROTOCOLS a tier can speak. Not vendors: `claude` is the Anthropic-compatible
 * protocol and `codex` the OpenAI-compatible one, and real deployments run DeepSeek, GLM,
 * Kimi or MiniMax over either.
 *
 * The array is the source and the type derives from it, so a third protocol has to be added
 * in exactly one place. It was written out three times — this union, `z.enum(['claude',
 * 'codex'])` in the configure-provider route, and the Dialect chooser's options in
 * `ModelsPanel` — and none of the three could see the others. `db/enums.ts`'s ratchet reads
 * only that file, and an enum re-spelled as `{ value, label }` objects is invisible to it
 * anyway (the extracted array is twice the length, so it fails the superset test).
 */
export const DIALECTS = ['claude', 'codex'] as const;

export type Dialect = (typeof DIALECTS)[number];

export type ConfigureAuth =
  | { mode: 'oauth' }
  | { mode: 'api-key'; apiKey: string; baseUrl?: string };

export interface ConfigureProviderRequest {
  tier: TierKey;
  provider: Dialect;
  model: string;
  auth: ConfigureAuth;
  dryRun?: boolean; // default true on the server
}

export interface ConfigureProviderResponse {
  verified: boolean;
  reason: string;
  applied: boolean;
  tier: string;
  provider: string;
  model: { id: string; family: string; tier: string; recognized: boolean };
  probe?: { reachable: boolean; modelListed: boolean | null; detail: string };
}
