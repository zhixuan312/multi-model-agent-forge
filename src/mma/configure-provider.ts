/**
 * Types for mmagent's `POST /configure-provider` endpoint. mmagent OWNS the
 * validate ladder + the runtime in-memory hot-swap; Forge only calls it
 * (Validate = dryRun:true, Apply = dryRun:false). Shapes mirror the live v5.3.x
 * contract verified against the running daemon.
 */
export type Dialect = 'claude' | 'codex';
export type AgentTier = 'main' | 'complex' | 'standard';

export type ConfigureAuth =
  | { mode: 'oauth' }
  | { mode: 'api-key'; apiKey: string; baseUrl?: string };

export interface ConfigureProviderRequest {
  tier: AgentTier;
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
