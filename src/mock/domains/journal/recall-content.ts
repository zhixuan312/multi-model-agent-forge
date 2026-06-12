import { mockLatency } from '@/mock/config';
import pinnedSeed from '@/mock/seed/recall-pinned.json';
import faqSeed from '@/mock/seed/recall-faq.json';
import type { PinnedQA, FaqItem } from '@/journal/recall-content';

/** The user's pinned Q&A (file-backed seed in mock mode). */
export async function getPinned(): Promise<PinnedQA[]> {
  await mockLatency(120);
  return pinnedSeed as PinnedQA[];
}

/** The team's frequently-asked recall questions. */
export async function getFaqs(): Promise<FaqItem[]> {
  await mockLatency(120);
  return faqSeed as FaqItem[];
}
