import { isMutableJournalStatus } from '@/db/enums';
import type { JournalLearningStatus, TerminalJournalStatus } from '@/db/enums';
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

/** Why each terminal status cannot be changed — total, so a new terminal one needs a reason. */
const TERMINAL_REASON = {
  recorded: 'recorded journal rows are immutable',
  removed: 'removed journal rows are terminal',
} as const satisfies Record<TerminalJournalStatus, string>;

export function assertMutableJournalStatus(status: JournalLearningStatus): void {
  // Asks the SAME question `allowed-actions` asks when it decides whether to offer the
  // edit/remove buttons at all — see `MUTABLE_JOURNAL_STATUS`. These were two separate
  // spellings of one rule, one positive and one negative.
  if (isMutableJournalStatus(status)) return;
  throw new Error(TERMINAL_REASON[status as TerminalJournalStatus]);
}
