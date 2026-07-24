import { z } from 'zod';

export type ContainerProvider = 'anthropic' | 'openai';

const tierSchema = z
  .object({
    type: z.enum(['claude', 'codex']),
    model: z.string().min(1),
    baseUrl: z.string().url().optional(),
    apiKeyEnv: z.string().min(1).optional(),
  })
  .strict();

export const containerConfigSchema = z
  .object({
    agents: z
      .object({
        main: tierSchema,
        complex: tierSchema,
        standard: tierSchema,
      })
      .strict(),
  })
  .strict();

// Single source of truth: the generation logic lives in the plain-JS boot script,
// because that script runs at container start with no TypeScript toolchain and no
// build step. This module is a thin typed re-export — it must never re-declare the
// tier/provider mapping, or the two copies will drift.
export { buildGeneratedConfig, resolveOrWriteConfig } from '../../scripts/container-bootstrap.mjs';
