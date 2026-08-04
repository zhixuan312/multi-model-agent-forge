// @vitest-environment node
/**
 * @-mentioning a teammate has to reach them.
 *
 * The composer has always offered an @-mention autocomplete and its only effect was a
 * highlight in the bubble: no notification, no participant. That is the worst kind of
 * half-feature — the author watches the name complete and reasonably believes the person
 * has been pinged, while the person never hears anything at all.
 *
 * The cases below are the ones that decide whether the wiring is trustworthy rather than
 * merely present: who is EXCLUDED, and what happens when resolution finds nobody.
 */
import { vi } from 'vitest';
import { notifyMentions } from '@/collab/notify-mentions';
import { createMockDb } from '../test-utils/mock-db';

const POOL = [
  { id: 'm-bo', displayName: 'Bo Chen', avatarTint: '#111' },
  { id: 'm-priya', displayName: 'Priya Nair', avatarTint: '#222' },
];

vi.mock('@/auth/members-core', () => ({
  listTeamMemberRefs: vi.fn(async (teamId: string | null) => (teamId ? POOL : [])),
}));

function run(bodyMd: string, over: Partial<Parameters<typeof notifyMentions>[1]> = {}) {
  const db = createMockDb({
    'select:project': [{ name: 'Atlas' }],
    'insert:ops_notification': [{ id: 'n1' }],
  });
  const result = notifyMentions(db as never, {
    projectId: 'p1',
    messageId: 'msg-1',
    bodyMd,
    authorId: 'm-bo',
    authorName: 'Bo Chen',
    teamId: 't1',
    where: 'Spec · Craft',
    ...over,
  });
  return { db, result };
}

const inserted = (db: ReturnType<typeof createMockDb>) =>
  db._callsFor('ops_notification')
    .filter((c) => c.method === 'values')
    .map((c) => c.args[0] as { memberId: string; kind: string; sourceId: string; subtitle: string });

describe('notifyMentions', () => {
  it('notifies each teammate named in the message', async () => {
    const { db, result } = run('@Priya Nair can you look at this?');
    expect(await result).toBe(1);
    const rows = inserted(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].memberId).toBe('m-priya');
    expect(rows[0].kind).toBe('mention');
    expect(rows[0].subtitle).toBe('Atlas · Spec · Craft');
  });

  /** Mentioning yourself is a figure of speech, not a request for a notification. */
  it('never notifies the author', async () => {
    const { db, result } = run('@Bo Chen is on it');
    expect(await result).toBe(0);
    expect(db._wasCalled('ops_notification', 'insert')).toBe(false);
  });

  /**
   * The dedup key is per (message, member) and `ops_notification` has a unique index on
   * `source_id` — so a retried POST cannot ping someone twice for one message. Without the
   * member half, two people named in one message would collide and the second would be
   * silently dropped by `onConflictDoNothing`.
   */
  it('keys dedup by message AND member, so two mentions both land', async () => {
    const { db, result } = run('@Priya Nair and @Bo Chen — actually @Priya Nair only');
    expect(await result).toBe(1); // Bo is the author; Priya named twice is still one person
    expect(inserted(db)[0].sourceId).toBe('mention:msg-1:m-priya');
  });

  it('notifies nobody when the caller has no team pool', async () => {
    const { db, result } = run('@Priya Nair look', { teamId: null });
    expect(await result).toBe(0);
    expect(db._wasCalled('ops_notification', 'insert')).toBe(false);
  });

  it('ignores an @ that resolves to no teammate', async () => {
    const { db, result } = run('@nobody @Bobby hello');
    expect(await result).toBe(0);
    expect(db._wasCalled('ops_notification', 'insert')).toBe(false);
  });

  /**
   * The message row is already committed by the time this runs. Reporting a failure to the
   * author because the fan-out broke would tell them their message did not post, which is
   * false — so this swallows and returns 0.
   */
  it('never throws — a committed message must not be reported as failed', async () => {
    const db = { select: () => { throw new Error('db down'); } };
    await expect(
      notifyMentions(db as never, {
        projectId: 'p1', messageId: 'm', bodyMd: '@Priya Nair', authorId: 'm-bo',
        authorName: 'Bo Chen', teamId: 't1', where: 'Spec · Craft',
      }),
    ).resolves.toBe(0);
  });
});
