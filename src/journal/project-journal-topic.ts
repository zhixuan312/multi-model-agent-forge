/**
 * Normalise a journal topic to the ENGINE's grammar: `^[a-z0-9]+(-[a-z0-9]+)*$`.
 *
 * Deliberately separate from `build/slug.ts#slugRefComponent`, which keeps `.` and `_`
 * because git refs allow them — topics do not, so folding the two would mint topics the
 * engine rejects. Empty input becomes `unscoped` rather than an invalid empty topic.
 */
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
