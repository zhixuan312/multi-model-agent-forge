import { ProseBlock } from '@/components/patterns/prose-block';
import { Card, CardContent } from '@/components/ui/card';
import { Eyebrow, Heading } from '@/components/ui/typography';
import { PRINCIPLES } from '@/content/direction-reference';

/**
 * The six global principles as a responsive grid of numbered `Card`s — verbatim
 * and in order from DIRECTION.md § Global Principles. Scannable at a glance; the
 * body text is the real principle, not a paraphrase.
 */
export function PrinciplesGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {PRINCIPLES.map((p) => (
        <Card key={p.n} className="h-full">
          <CardContent className="flex h-full flex-col gap-2">
            <Eyebrow as="span" className="!text-accent">
              {String(p.n).padStart(2, '0')}
            </Eyebrow>
            <Heading as="h4" className="!text-base">
              {p.title}
            </Heading>
            <ProseBlock variant="compact">{p.text}</ProseBlock>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
