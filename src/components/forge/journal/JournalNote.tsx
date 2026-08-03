import { BookText } from 'lucide-react';
import { RailNote } from '@/components/patterns/feature-rail';

/**
 * JournalNote — the rail note for the Journal page. Uses the shared `RailNote`
 * (same box + house style as the Team Settings + Workspace notes): titled `###`
 * sections + bullets, plain language. Shown in the 1/3 rail whenever it isn't
 * occupied by a selected node's detail.
 */
/* The two notes share their sections verbatim, so the wording cannot drift between
   tabs — only which sections each one shows differs. */
const DECISION_GRAPH = `### Decision graph

- **Each node** — one decision the team reached: its crux, the why, the consequence
- **Edges** — link refinements and supersessions between nodes`;

const STATUS_MEANINGS = `### What the status means

- **Adopted** — a live learning
- **Superseded** — replaced by a newer node
- **Dropped · inconclusive** — abandoned or unresolved`;

const READ_ONLY = `### Read-only

- **Recorded by MMA** — written at project freeze, never edited here`;

export function JournalNote() {
  return (
    <RailNote icon={<BookText />}>
      {[DECISION_GRAPH, STATUS_MEANINGS, READ_ONLY].join('\n\n')}
    </RailNote>
  );
}

/**
 * The Graph tab's note. It omits the status meanings because the Legend beside it keys
 * every status with its colour swatch — StageShell stacks the note directly above the
 * navigator, so passing the full note there printed the four meanings twice in one rail.
 */
export function GraphNote() {
  return <RailNote icon={<BookText />}>{[DECISION_GRAPH, READ_ONLY].join('\n\n')}</RailNote>;
}
