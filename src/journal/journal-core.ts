import type { LearningCategory, LearningSource } from '@/journal/types';

type LearningType = 'challenge' | 'insight' | 'decision' | 'pattern';
type LearningOrigin = 'exploration' | 'spec' | 'plan' | 'execute' | 'review' | 'discussion';

const CATEGORY_TO_TYPE: Record<LearningCategory, LearningType> = {
  decision: 'decision', design: 'decision',
  behavior: 'insight', process: 'insight', knowledge: 'insight', style: 'insight',
};

const SOURCE_TO_ORIGIN: Record<LearningSource, LearningOrigin> = {
  Exploration: 'exploration', Spec: 'spec', Plan: 'spec',
  Execute: 'spec', Review: 'spec', Journal: 'spec', Manual: 'spec',
};

export function mapCategoryToType(category: string): LearningType {
  return CATEGORY_TO_TYPE[category as LearningCategory] ?? 'insight';
}

export function mapSourceToOrigin(source: string): LearningOrigin {
  return SOURCE_TO_ORIGIN[source as LearningSource] ?? 'spec';
}

export function formatTags(text: string, category: string, source: string): string {
  return `[category:${category}][source:${source}] ${text}`;
}

export function parseTags(bodyMd: string): { category: string | null; source: string | null; text: string } {
  const catMatch = bodyMd.match(/^\[category:(\w+)\]/);
  const srcMatch = bodyMd.match(/\[source:(\w+)\]/);
  let text = bodyMd;
  if (catMatch) text = text.replace(catMatch[0], '');
  if (srcMatch) text = text.replace(srcMatch[0], '');
  return { category: catMatch?.[1] ?? null, source: srcMatch?.[1] ?? null, text: text.trim() };
}
