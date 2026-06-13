import { USE_MOCK } from '@/mock/config';
import { mockNotifications } from '@/mock/domains/collab';
import type { NotificationItem } from '@/collab/types';

/**
 * List a member's notification feed (mentions + approvals). Mock-backed today;
 * the real store lands with the `section_participant` / `notification` tables.
 * Until then the real path returns an empty feed so the bell renders quiet
 * rather than throwing — keeping the primitive reusable without a migration.
 */
export async function listNotifications(memberId: string): Promise<NotificationItem[]> {
  if (USE_MOCK) return mockNotifications();
  void memberId;
  return [];
}
