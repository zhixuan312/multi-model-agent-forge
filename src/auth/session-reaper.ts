import 'dotenv/config';
import { getSql } from '@/db/client';
import { deleteExpiredSessions } from '@/auth/session-store';

/**
 * Expired-session reaper (Spec 1 NFR F19) — `DELETE FROM session WHERE
 * expires_at < now()`. Validation rejects stale sessions regardless; the reaper
 * keeps the table bounded. Run on a schedule (cron/systemd timer) and on demand
 * via `pnpm db:reap`. No in-app scheduler is built in Spec 1.
 */
export async function reapExpiredSessions(): Promise<number> {
  return deleteExpiredSessions();
}

// Run when invoked directly (tsx src/auth/session-reaper.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  reapExpiredSessions()
    .then(async (count) => {
      // eslint-disable-next-line no-console
      console.log(`Reaped ${count} expired session(s).`);
      await getSql().end();
      process.exit(0);
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('Session reaping failed:', err);
      try {
        await getSql().end();
      } catch {
        /* ignore */
      }
      process.exit(1);
    });
}
