import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { listTeamMemberRefs } from '@/auth/members-core';
import { mentionSpans } from '@/collab/mentions';
import { insertNotification } from '@/collab/notification-store';

/**
 * Turn the @-mentions in a posted message into notifications.
 *
 * The composer has always offered an @-mention autocomplete, and its only effect was a
 * highlight in the rendered bubble: no participant added, no notification sent. An
 * affordance that completes a teammate's name and then does nothing with it is worse than
 * not offering one — the author reasonably believes the person has been pinged, and the
 * person never hears about it. This is the wiring that makes the affordance true.
 *
 * Deliberately NOT participation. Being named in a message is not the same as being put on
 * the hook for approving something, and the explicit Invite picker
 * (`POST /projects/:id/spec/invite`) remains the one way to become a participant. Mentioning
 * tells someone to look; inviting asks them to sign off.
 *
 * Scope and safety:
 *  - The pool is `listTeamMemberRefs(teamId)` — the same team-scoped list the composer
 *    autocompletes from, so a mention can only ever resolve to a teammate. A caller with no
 *    team (an org admin) has no pool, and notifies nobody rather than falling back to a
 *    wider one.
 *  - The author is skipped: @-mentioning yourself notifies nobody.
 *  - `sourceId` is per (message, member), and `ops_notification` has a unique index on it
 *    with `onConflictDoNothing`, so a retried POST cannot double-notify.
 *  - Never throws. A message that was accepted must not be reported as failed because the
 *    notification fan-out had a problem; the caller has already committed the row.
 */
export async function notifyMentions(
  db: Db,
  args: {
    projectId: string;
    messageId: string;
    bodyMd: string;
    /** The message author — excluded from the recipients. */
    authorId: string;
    authorName: string;
    /** Null for an org admin, who has no team pool — then there is nobody to resolve against. */
    teamId: string | null;
    /** Where the reader will land, e.g. `Spec · Craft`. */
    where: string;
  },
): Promise<number> {
  if (!args.teamId) return 0;
  try {
    const pool = await listTeamMemberRefs(args.teamId, { db });
    const mentioned = new Map(
      mentionSpans(args.bodyMd, pool)
        .map((s) => s.member)
        .filter((m) => m.id !== args.authorId)
        .map((m) => [m.id, m] as const),
    );
    if (mentioned.size === 0) return 0;

    const [proj] = await db
      .select({ name: project.name })
      .from(project)
      .where(eq(project.id, args.projectId))
      .limit(1);

    for (const m of mentioned.values()) {
      await insertNotification(
        {
          memberId: m.id,
          kind: 'mention',
          title: `${args.authorName} mentioned you`,
          subtitle: `${proj?.name ?? 'Project'} · ${args.where}`,
          sourceId: `mention:${args.messageId}:${m.id}`,
        },
        db,
      );
    }
    return mentioned.size;
  } catch {
    return 0;
  }
}
