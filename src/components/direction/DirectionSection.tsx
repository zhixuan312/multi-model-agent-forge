import { ProseBlock } from '@/components/patterns';
import type { DirectionSection as Section } from '@/content/direction-sections';
import { PrinciplesGrid } from './PrinciplesGrid';
import { RouteBlock } from './RouteBlock';
import { LifecycleFlow } from './LifecycleFlow';
import { LayersStack } from './LayersStack';
import { StageFlow } from './StageFlow';
import { ResearchSources } from './ResearchSources';
import { JournalRecordMechanism, JournalRecallMechanism } from './JournalMechanism';

/**
 * Renders one registry section: the heading, the narrative body, then the section's
 * structured visual (principles grid, criteria reference, flow) when it declares
 * one. "In the code" source pointers sit in a footer note.
 *
 * Both markdown fields go through the governed `ProseBlock` — the app's single
 * markdown surface — so the manual inherits Forge's prose styling instead of
 * carrying a second markdown renderer and its own stylesheet.
 */
export function DirectionSection({ section }: { section: Section }) {
  return (
    <section id={section.id} aria-label={section.title} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold leading-tight text-ink">
          {section.title}
          {section.wip && (
            <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-accent-deep">
              Work in progress
            </span>
          )}
        </h2>
        <ProseBlock>{section.body}</ProseBlock>
      </div>
      {section.component === 'principles' && <PrinciplesGrid />}
      {section.component === 'lifecycle' && <LifecycleFlow />}
      {section.component === 'layers' && <LayersStack />}
      {section.component === 'write-stages' && <StageFlow />}
      {section.component === 'research-sources' && <ResearchSources />}
      {section.component === 'journal-record' && <JournalRecordMechanism />}
      {section.component === 'journal-recall' && <JournalRecallMechanism />}
      {section.routeKey && <RouteBlock routeKey={section.routeKey} />}
      {section.underTheHood && (
        <div className="flex flex-col gap-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-4 py-3">
          <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-ink-faint">
            In the code
          </span>
          <ProseBlock variant="compact">{section.underTheHood}</ProseBlock>
        </div>
      )}
    </section>
  );
}
