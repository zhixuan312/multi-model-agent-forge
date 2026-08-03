import { ProseBlock } from '@/components/patterns/prose-block';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heading } from '@/components/ui/typography';
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
 * one. "In the code" source pointers sit in a closing card.
 *
 * Every surface here is a Forge primitive — `Heading` for the title, `Badge` for
 * the work-in-progress flag, `Card` for the source-pointer note — so the manual
 * inherits the app's design system rather than carrying its own styling. Both
 * markdown fields go through the governed `ProseBlock`, the app's single markdown
 * surface, for the same reason.
 */
export function DirectionSection({ section }: { section: Section }) {
  return (
    <section id={section.id} aria-label={section.title} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="!text-xl">{section.title}</Heading>
          {section.wip && (
            <Badge variant="accent" size="sm">
              Work in progress
            </Badge>
          )}
        </div>
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
        <Card>
          <CardHeader>
            <CardTitle className="!text-sm">In the code</CardTitle>
          </CardHeader>
          <CardContent>
            <ProseBlock variant="compact">{section.underTheHood}</ProseBlock>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
