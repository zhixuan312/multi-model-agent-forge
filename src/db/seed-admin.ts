import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb, getSql, type Db } from '@/db/client';
import { member, memberIdentity } from '@/db/schema/identity';
import { hashPassword, passwordSchema } from '@/auth/password';
import { logEvent } from '@/observability/log-event';

/**
 * First-admin bootstrap seed (Spec 1 "First-admin bootstrap seed").
 *
 * If the team has zero members, create the first member (`is_admin = true`,
 * default avatar_tint) + its `local` identity from `FORGE_ADMIN_USERNAME` /
 * `FORGE_ADMIN_PASSWORD`. Idempotent — a no-op when ANY member exists (never
 * overwrites an existing admin).
 *
 * Fail-fast (F35): on an empty DB, if the username or password is unset/blank,
 * or the password is below PASSWORD_MIN_LENGTH, throw and create NO member —
 * never a credential-less / weak admin that would lock everyone out.
 */
export interface SeedResult {
  created: boolean;
  username?: string;
  reason?: string;
}

export async function seedFirstAdmin(db: Db = getDb()): Promise<SeedResult> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member);

  if (count > 0) {
    return { created: false, reason: 'members already exist' };
  }

  const username = (process.env.FORGE_ADMIN_USERNAME ?? '').trim();
  const password = process.env.FORGE_ADMIN_PASSWORD ?? '';

  if (username === '') {
    logEvent({ level: 'error', event: 'startup.fatal' });
    throw new Error('FORGE_ADMIN_USERNAME is unset/blank — cannot seed the first admin.');
  }
  if (!passwordSchema.safeParse(password).success) {
    logEvent({ level: 'error', event: 'startup.fatal' });
    throw new Error(
      'FORGE_ADMIN_PASSWORD is unset/blank or below PASSWORD_MIN_LENGTH — refusing to seed a weak admin.',
    );
  }

  const passwordHash = await hashPassword(password);
  const [m] = await db
    .insert(member)
    .values({ username, displayName: username, isAdmin: true })
    .returning({ id: member.id });
  await db.insert(memberIdentity).values({
    memberId: m.id,
    provider: 'local',
    passwordHash,
  });

  logEvent({ level: 'info', event: 'member.create', targetId: m.id });
  return { created: true, username };
}

// Run when invoked directly (tsx src/db/seed-admin.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  seedFirstAdmin()
    .then(async (res) => {
      // eslint-disable-next-line no-console
      console.log(
        res.created
          ? `Seeded first admin: ${res.username}`
          : `Seed skipped (${res.reason}).`,
      );
      await getSql().end();
      process.exit(0);
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('Seed failed:', err.message);
      try {
        await getSql().end();
      } catch {
        /* ignore */
      }
      process.exit(1);
    });
}
