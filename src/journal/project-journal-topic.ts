export function normalizeProjectJournalTopic(input: string | null | undefined): string {
  const normalized = (input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'unscoped';
}

export function deriveDefaultProjectJournalTopic(
  repos: Array<{ slug?: string | null }> | null | undefined,
): string {
  const primary = repos?.[0]?.slug ?? '';
  return normalizeProjectJournalTopic(primary);
}

export function assertMutableJournalStatus(status: 'proposed' | 'kept' | 'removed' | 'recorded'): void {
  if (status === 'recorded') throw new Error('recorded journal rows are immutable');
  if (status === 'removed') throw new Error('removed journal rows are terminal');
}
