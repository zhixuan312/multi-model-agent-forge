import 'dotenv/config';
import { startLoopWorker } from '@/loops/scheduler';

/**
 * The Loops worker entrypoint (spec §5). Run alongside the Forge service:
 *   `pnpm loop-worker`
 * It ticks once a minute, firing due/enabled loops on their cron. Requires the
 * same DATABASE_URL + a reachable MMA + a Connections Git token, like the app.
 */
 
console.log('[loops] worker starting — ticking every 60s');
const stop = startLoopWorker();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stop();
     
    console.log('[loops] worker stopped');
    process.exit(0);
  });
}
