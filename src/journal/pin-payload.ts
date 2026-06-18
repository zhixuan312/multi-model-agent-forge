import { z } from 'zod';

/**
 * Shared request-payload pieces for the pin routes. The client supplies the
 * just-recalled answer verbatim (the routes never dispatch to MMA), so the
 * findings shape mirrors `PinnedFinding` — persisted so a pin renders at the
 * same fidelity as the live recall.
 */
export const pinFindingSchema = z.object({
  learning: z.string(),
  context: z.string(),
  relevance: z.string(),
  nodeId: z.string(),
  category: z.string(),
  status: z.string(),
});

export const pinFindingsSchema = z
  .array(pinFindingSchema)
  .optional()
  .transform((f) => f ?? []);
