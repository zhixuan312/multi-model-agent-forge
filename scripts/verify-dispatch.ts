import 'dotenv/config';
import { buildMmaClient } from '@/mma/server-client';
async function main() {
  const repo = '/Users/zhangzhixuan/Documents/code/mma-parent/multi-model-agent-forge/.forge-workspace/Self Service Demo';
  const client = await buildMmaClient();
  const { batchId } = await client.investigate(repo, { question: 'What does this repo do? One sentence.' });
  console.log('DISPATCH OK — batchId =', batchId, '(X-MMA-Main-Model now sent by default)');
}
main().catch((e) => { console.error('DISPATCH FAILED:', (e as Error).message); process.exit(1); });
