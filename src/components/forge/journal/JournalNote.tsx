import { BookText } from 'lucide-react';
import { RailNote } from '@/components/patterns/feature-rail';

/**
 * JournalNote — the rail note for the Journal page. Uses the shared
 * `SettingsAccessNote` (same box + house style as the Team Settings + Workspace
 * notes): titled `###` sections + bullets, plain language. Shown in the 1/3 rail
 * whenever it isn't occupied by a selected node's detail.
 */
const JOURNAL_NOTE = `### Decision graph

- **Each node** — one decision the team reached: its crux, the why, the consequence
- **Edges** — link refinements and supersessions between nodes

### What the status means

- **Adopted** — a live learning
- **Superseded** — replaced by a newer node
- **Dropped · inconclusive** — abandoned or unresolved

### Read-only

- **Recorded by MMA** — written at project freeze, never edited here`;

export function JournalNote() {
  return <RailNote icon={<BookText />}>{JOURNAL_NOTE}</RailNote>;
}
