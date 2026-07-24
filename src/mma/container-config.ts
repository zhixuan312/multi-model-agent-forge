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

// @ts-expect-error — plain-JS boot script, intentionally untyped at the boundary.
export { buildGeneratedConfig, resolveOrWriteConfig } from '../../scripts/container-bootstrap.mjs';
