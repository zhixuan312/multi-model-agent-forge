// @vitest-environment node
import { vi } from 'vitest';
import { getLatestSpec } from '@/spec/assemble';

const readSpecFileAsyncMock = vi.fn();

vi.mock('@/projects/project-files', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/projects/project-files')>();
  return {
    ...orig,
    readSpecFileAsync: (...args: unknown[]) => readSpecFileAsyncMock(...args),
  };
});

beforeEach(() => {
  readSpecFileAsyncMock.mockReset();
});

describe('getLatestSpec', () => {
  it('returns null when no spec.md exists', async () => {
    readSpecFileAsyncMock.mockResolvedValue(null);
    const result = await getLatestSpec(null, 'proj-1');
    expect(result).toBeNull();
  });

  it('returns version and body from spec.md', async () => {
    readSpecFileAsyncMock.mockResolvedValue({
      version: 3,
      updatedAt: '2026-07-01',
      bodyMd: '## Context\n\n### Background\n\nSome content',
    });
    const result = await getLatestSpec(null, 'proj-1');
    expect(result).toEqual({
      version: 3,
      bodyMd: '## Context\n\n### Background\n\nSome content',
    });
  });
});
