/**
 * Extract usage scalar fields from an MMA terminal envelope.
 * Used by the poll-manager terminal handler and the backfill script.
 * Gracefully returns nulls for malformed or legacy envelopes.
 */

export interface UsageFields {
  costUsd: string | null;
  savedVsMainUsd: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  implementerModel: string | null;
  reviewerModel: string | null;
  implementerTier: string | null;
}

export function extractUsageFields(envelope: unknown): UsageFields {
  const nullResult: UsageFields = {
    costUsd: null,
    savedVsMainUsd: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    implementerModel: null,
    reviewerModel: null,
    implementerTier: null,
  };

  if (!envelope || typeof envelope !== 'object') return nullResult;
  const e = envelope as Record<string, unknown>;

  try {
    const costSummary = e.costSummary as
      | { totalActualCostUSD?: number; totalCostDeltaVsMainUSD?: number | null }
      | undefined;
    const timings = e.taskTimings as { wallClockMs?: number } | undefined;

    const costUsd =
      typeof costSummary?.totalActualCostUSD === 'number'
        ? String(costSummary.totalActualCostUSD)
        : null;
    const savedVsMainUsd =
      typeof costSummary?.totalCostDeltaVsMainUSD === 'number'
        ? String(costSummary.totalCostDeltaVsMainUSD)
        : null;

    const totalInputTokens =
      typeof (e as Record<string, unknown>).totalInputTokens === 'number'
        ? (e as Record<string, unknown>).totalInputTokens as number
        : null;
    const totalOutputTokens =
      typeof (e as Record<string, unknown>).totalOutputTokens === 'number'
        ? (e as Record<string, unknown>).totalOutputTokens as number
        : null;

    const durationMs =
      typeof timings?.wallClockMs === 'number' ? timings.wallClockMs : null;

    // Locate implementer and reviewer by stage name, not array index
    let implementerModel: string | null = null;
    let reviewerModel: string | null = null;
    let implementerTier: string | null = null;

    const results = e.results as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(results) && results.length > 0) {
      const firstResult = results[0];
      const stages = (
        (firstResult?.stages as Array<{ name?: string; model?: string; tier?: string }>) ??
        (e.stages as Array<{ name?: string; model?: string; tier?: string }>) ??
        []
      );
      for (const st of stages) {
        if (st.name === 'implementing') {
          if (typeof st.model === 'string') implementerModel = st.model;
          if (typeof st.tier === 'string') implementerTier = st.tier;
        }
        if (st.name === 'reviewing' && typeof st.model === 'string') {
          reviewerModel = st.model;
        }
      }
    }

    if (!implementerModel && Array.isArray(e.stages)) {
      for (const st of e.stages as Array<{ name?: string; model?: string; tier?: string }>) {
        if (st.name === 'implementing') {
          if (typeof st.model === 'string') implementerModel = st.model;
          if (typeof st.tier === 'string') implementerTier = st.tier;
        }
        if (st.name === 'reviewing' && typeof st.model === 'string') {
          reviewerModel = st.model;
        }
      }
    }

    // Fallback: check results[0].sessions.implementer.tier (HTTP response shape)
    if (!implementerTier) {
      const sessions = (results?.[0] as Record<string, unknown> | undefined)?.sessions as
        | { implementer?: { tier?: string } }
        | undefined;
      if (typeof sessions?.implementer?.tier === 'string') {
        implementerTier = sessions.implementer.tier;
      }
    }

    // Fallback: check top-level agentType
    if (!implementerTier && typeof (e as Record<string, unknown>).agentType === 'string') {
      implementerTier = (e as Record<string, unknown>).agentType as string;
    }

    return {
      costUsd,
      savedVsMainUsd,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      durationMs,
      implementerModel,
      reviewerModel,
      implementerTier,
    };
  } catch {
    return nullResult;
  }
}
