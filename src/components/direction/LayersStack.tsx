import { cn } from '@/lib/cn';
import { ProseBlock } from '@/components/patterns/prose-block';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Eyebrow, Mono } from '@/components/ui/typography';
import { AGENT_LAYERS, type AgentLayer } from '@/content/direction-reference';

/** One layer card. The main agent — yours, and never one of our slots — is the
 *  only card that takes the accent treatment; the configurable slots stay neutral. */
function LayerCard({ layer }: { layer: AgentLayer }) {
  const isMain = layer.kind === 'main';
  return (
    <Card className={cn('h-full', isMain && 'border-accent bg-accent-tint/25')}>
      <CardHeader className={cn(isMain && 'border-accent/40 bg-accent-tint/40')}>
        <CardTitle className="!text-sm">{layer.name}</CardTitle>
        <ProseBlock variant="compact" className="shrink-0 !text-ink-faint">
          {layer.tag}
        </ProseBlock>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ProseBlock variant="compact">{layer.role}</ProseBlock>
        <div className="flex flex-wrap items-baseline gap-2">
          <Eyebrow as="span">Models</Eyebrow>
          <Mono className="!text-xs">{layer.examples}</Mono>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The three agent layers: the main agent (yours, keeps judgment) above the two
 * configurable labor slots — complex and standard. The relationship is carried
 * by the layout and the slot caption, not by a connector glyph: the main agent
 * sits alone on its own row, and the two slots share the row beneath it.
 */
export function LayersStack() {
  const main = AGENT_LAYERS.filter((l) => l.kind === 'main');
  const slots = AGENT_LAYERS.filter((l) => l.kind !== 'main');
  return (
    <div className="flex flex-col gap-4">
      {main.map((l) => (
        <LayerCard key={l.name} layer={l} />
      ))}
      {slots.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow as="h4">Delegates labor to the slots you configure</Eyebrow>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {slots.map((l) => (
              <LayerCard key={l.name} layer={l} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
