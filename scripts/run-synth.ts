import 'dotenv/config';
import { synthesize } from '@/exploration/synthesize';
async function main() {
  const res = await synthesize('ea95a48f-12df-4328-98ae-2f40a915ade8', null);
  console.log('synthesize result:', JSON.stringify(res));
}
main().catch((e) => { console.error('SYNTH ERROR:', (e as Error).message); process.exit(1); });
