import { redirect } from 'next/navigation';
import { GUIDE_FIRST_SECTION_ID } from '@/content/guide-nav';

/**
 * "Guide" index — a bare entry point. Every section is its own page, reached from
 * the nested Guide list in the left rail, so the index just lands the reader on
 * the first section. Universal: no role gate beyond the authed `(app)` layout.
 */
export default function GuideIndexPage() {
  redirect(`/settings/guide/${GUIDE_FIRST_SECTION_ID}`);
}
