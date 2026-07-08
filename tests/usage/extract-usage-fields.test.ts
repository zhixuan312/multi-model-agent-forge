import { describe, it, expect } from 'vitest';
import { extractUsageFields } from '@/usage/extract-usage-fields';

describe('extractUsageFields', () => {
  const validEnvelope = {
    task: { taskId: 't0', type: 'audit', status: 'done' },
    output: { summary: 'ok', filesChanged: [], contextBlockId: null },
    execution: {
      sessions: { implementer: 'sess-impl', reviewer: 'sess-rev' },
      worktree: null,
    },
    metrics: {
      totalCostUsd: 0.1234,
      savedVsMainCostUsd: 0.5678,
      mainEquivalentCostUsd: 0.6912,
      totalDurationMs: 42000,
      totalUsage: {
        inputTokens: 5000,
        outputTokens: 3000,
        cachedReadTokens: 0,
        cachedNonReadTokens: 0,
      },
      implementer: { durationMs: 30000, costUsd: 0.05, usage: { inputTokens: 3000, outputTokens: 2000, cachedReadTokens: 0, cachedNonReadTokens: 0 } },
      reviewer: { durationMs: 12000, costUsd: 0.0734, usage: { inputTokens: 2000, outputTokens: 1000, cachedReadTokens: 0, cachedNonReadTokens: 0 } },
    },
    raw: { implementer: '', reviewer: '' },
    error: null,
  };

  it('extracts all fields from a well-formed envelope', () => {
    const fields = extractUsageFields(validEnvelope);
    expect(fields.costUsd).toBe('0.1234');
    expect(fields.savedVsMainUsd).toBe('0.5678');
    expect(fields.inputTokens).toBe(5000);
    expect(fields.outputTokens).toBe(3000);
    expect(fields.durationMs).toBe(42000);
  });

  it('returns nulls for a completely empty envelope', () => {
    const fields = extractUsageFields({});
    expect(fields.costUsd).toBeNull();
    expect(fields.savedVsMainUsd).toBeNull();
    expect(fields.inputTokens).toBeNull();
    expect(fields.outputTokens).toBeNull();
    expect(fields.durationMs).toBeNull();
  });

  it('returns nulls for null input', () => {
    const fields = extractUsageFields(null);
    expect(fields.costUsd).toBeNull();
  });

  it('returns nulls for non-object input', () => {
    const fields = extractUsageFields('not an object');
    expect(fields.costUsd).toBeNull();
  });

  it('handles a missing reviewer (single-phase task)', () => {
    const envelope = {
      ...validEnvelope,
      metrics: { ...validEnvelope.metrics, reviewer: null },
    };
    const fields = extractUsageFields(envelope);
    expect(fields.costUsd).toBe('0.1234');
  });

  it('handles savedVsMainCostUsd = 0', () => {
    const envelope = {
      ...validEnvelope,
      metrics: { ...validEnvelope.metrics, savedVsMainCostUsd: 0 },
    };
    const fields = extractUsageFields(envelope);
    expect(fields.savedVsMainUsd).toBe('0');
  });

  it('handles null savedVsMainCostUsd', () => {
    const envelope = {
      ...validEnvelope,
      metrics: { ...validEnvelope.metrics, savedVsMainCostUsd: null },
    };
    const fields = extractUsageFields(envelope);
    expect(fields.savedVsMainUsd).toBeNull();
  });

  it('returns null tokens when totalUsage is absent', () => {
    const envelope = {
      ...validEnvelope,
      metrics: { ...validEnvelope.metrics, totalUsage: undefined },
    };
    const fields = extractUsageFields(envelope);
    expect(fields.inputTokens).toBeNull();
    expect(fields.outputTokens).toBeNull();
  });

  it('extracts cost as string for numeric column', () => {
    const fields = extractUsageFields(validEnvelope);
    expect(typeof fields.costUsd).toBe('string');
    expect(typeof fields.savedVsMainUsd).toBe('string');
  });
});
