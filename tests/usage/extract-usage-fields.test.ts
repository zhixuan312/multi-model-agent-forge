import { describe, it, expect } from 'vitest';
import { extractUsageFields } from '@/usage/extract-usage-fields';

describe('extractUsageFields', () => {
  const validEnvelope = {
    costSummary: {
      totalActualCostUSD: 0.1234,
      totalCostDeltaVsMainUSD: 0.5678,
      totalMainEquivalentUSD: 0.6912,
    },
    taskTimings: { wallClockMs: 42000 },
    totalInputTokens: 5000,
    totalOutputTokens: 3000,
    stages: [
      { name: 'implementing', model: 'deepseek-v4-pro', tier: 'standard', inputTokens: 3000, outputTokens: 2000 },
      { name: 'reviewing', model: 'gpt-5.5', tier: 'complex', inputTokens: 2000, outputTokens: 1000 },
    ],
    results: [{ cost: { implementerUsd: 0.05, reviewerUsd: 0.0734 } }],
  };

  it('extracts all fields from a well-formed envelope', () => {
    const fields = extractUsageFields(validEnvelope);
    expect(fields.costUsd).toBe('0.1234');
    expect(fields.savedVsMainUsd).toBe('0.5678');
    expect(fields.inputTokens).toBe(5000);
    expect(fields.outputTokens).toBe(3000);
    expect(fields.durationMs).toBe(42000);
    expect(fields.implementerModel).toBe('deepseek-v4-pro');
    expect(fields.reviewerModel).toBe('gpt-5.5');
    expect(fields.implementerTier).toBe('standard');
  });

  it('returns nulls for a completely empty envelope', () => {
    const fields = extractUsageFields({});
    expect(fields.costUsd).toBeNull();
    expect(fields.savedVsMainUsd).toBeNull();
    expect(fields.inputTokens).toBeNull();
    expect(fields.outputTokens).toBeNull();
    expect(fields.durationMs).toBeNull();
    expect(fields.implementerModel).toBeNull();
    expect(fields.reviewerModel).toBeNull();
  });

  it('returns nulls for null input', () => {
    const fields = extractUsageFields(null);
    expect(fields.costUsd).toBeNull();
  });

  it('returns nulls for non-object input', () => {
    const fields = extractUsageFields('not an object');
    expect(fields.costUsd).toBeNull();
  });

  it('handles missing reviewer stage', () => {
    const envelope = {
      ...validEnvelope,
      stages: [{ name: 'implementing', model: 'deepseek-v4-pro' }],
    };
    const fields = extractUsageFields(envelope);
    expect(fields.implementerModel).toBe('deepseek-v4-pro');
    expect(fields.reviewerModel).toBeNull();
  });

  it('handles totalCostDeltaVsMainUSD = 0 (old envelopes)', () => {
    const envelope = {
      ...validEnvelope,
      costSummary: { totalActualCostUSD: 0.1, totalCostDeltaVsMainUSD: 0 },
    };
    const fields = extractUsageFields(envelope);
    expect(fields.savedVsMainUsd).toBe('0');
  });

  it('handles null totalCostDeltaVsMainUSD', () => {
    const envelope = {
      ...validEnvelope,
      costSummary: { totalActualCostUSD: 0.1, totalCostDeltaVsMainUSD: null },
    };
    const fields = extractUsageFields(envelope);
    expect(fields.savedVsMainUsd).toBeNull();
  });

  it('looks up stage by name, not array position', () => {
    const envelope = {
      ...validEnvelope,
      stages: [
        { name: 'reviewing', model: 'reviewer-model' },
        { name: 'implementing', model: 'impl-model' },
      ],
    };
    const fields = extractUsageFields(envelope);
    expect(fields.implementerModel).toBe('impl-model');
    expect(fields.reviewerModel).toBe('reviewer-model');
  });

  it('extracts cost as string for numeric column', () => {
    const fields = extractUsageFields(validEnvelope);
    expect(typeof fields.costUsd).toBe('string');
    expect(typeof fields.savedVsMainUsd).toBe('string');
  });
});
