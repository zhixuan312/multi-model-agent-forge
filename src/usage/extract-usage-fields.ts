/**
 * Extract usage scalar fields from an MMA terminal envelope (v5.4+).
 * Shape: { metrics: { totalCostUsd, totalDurationMs, totalUsage, savedVsMainCostUsd } }
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

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
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

  try {
    const e = asObj(envelope);
    const metrics = asObj(e.metrics);

    const costUsd = typeof metrics.totalCostUsd === 'number' ? String(metrics.totalCostUsd) : null;
    const savedVsMainUsd = typeof metrics.savedVsMainCostUsd === 'number' ? String(metrics.savedVsMainCostUsd) : null;
    const durationMs = typeof metrics.totalDurationMs === 'number' ? metrics.totalDurationMs : null;

    const totalUsage = asObj(metrics.totalUsage);
    const inputTokens = typeof totalUsage.inputTokens === 'number' ? totalUsage.inputTokens : null;
    const outputTokens = typeof totalUsage.outputTokens === 'number' ? totalUsage.outputTokens : null;

    return { costUsd, savedVsMainUsd, inputTokens, outputTokens, durationMs, implementerModel: null, reviewerModel: null, implementerTier: null };
  } catch {
    return nullResult;
  }
}
