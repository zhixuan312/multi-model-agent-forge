'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NotebookPen, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Textarea } from '@/components/ui';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { recordedStore } from '@/components/forge/journal/recorded-store';

const CATEGORIES = ['decision', 'design', 'behavior', 'process', 'knowledge', 'style'] as const;
const CAT_STYLE: Record<string, string> = {
  decision: 'bg-accent-tint text-accent',
  design: 'bg-[var(--frost)] text-[var(--steel)]',
  behavior: 'bg-sage-tint text-[var(--sage-deep)]',
  process: 'bg-amber-tint text-[var(--amber)]',
  knowledge: 'bg-rose-tint text-[var(--rose)]',
  style: 'bg-surface-2 text-ink-soft',
};

/** Reframe a raw gist into a generalized principle (not an echo). */
function frameLearning(raw: string): string {
  let s = raw.trim();
  const strips = [
    /^(?:so|well|ok|okay|um|hmm|basically|essentially|honestly|like|just)[,\s]+/i,
    /^(?:the learning is|the point is|the key thing is|key takeaway is)[:,\s]+/i,
    /^(?:we|i|the team|you)\s+(?:learned|found|noticed|realised|realized|saw|think|feel|believe)\s+(?:that\s+)?/i,
    /^it\s+(?:turns out\s+)?(?:that\s+)?/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of strips) {
      const next = s.replace(re, '');
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
  }
  if (!s) return '';
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

export function RecordLearningButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<string>('decision');

  const framed = frameLearning(text);

  function reset() {
    setText('');
    setCategory('decision');
  }

  function record() {
    if (!framed) return;
    const id = String(9000 + recordedStore.get().length + 1);
    const today = new Date().toISOString().slice(0, 10);
    recordedStore.add({
      id,
      title: framed,
      status: 'adopted',
      tags: [],
      date: today,
      source: 'Manual',
      category,
      links: [],
      supersededBy: null,
      context: text.trim(),
      consequences: '',
      crux: framed,
      filename: `nodes/${id}-recorded.md`,
    });
    setOpen(false);
    reset();
    router.push(`/journal?view=nodes&node=${id}`);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" leftIcon={<NotebookPen />}>
          Record a learning
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record a learning</DialogTitle>
          <DialogDescription>
            Describe it in your own words — Forge generalizes it into a reusable principle before recording.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="What did you learn? e.g. “we kept hitting X, so from now on do Y instead”"
            className="!text-sm"
            autoFocus
          />

          {framed ? (
            <div className="rounded-[var(--r-md)] border border-line bg-surface-2/40 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                <Sparkles className="size-3 text-accent" /> Forge will record
              </p>
              <p className="text-sm leading-relaxed text-ink">{framed}</p>
            </div>
          ) : null}

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Category</p>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide capitalize transition-colors',
                    category === c ? cn('border-transparent', CAT_STYLE[c]) : 'border-line text-ink-soft hover:border-line-strong',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" onClick={record} disabled={!framed} leftIcon={<NotebookPen />}>
            Record to journal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
