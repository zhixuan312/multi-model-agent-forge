// Dispatch an mma-audit and poll to terminal, printing findings sorted by severity.
// Usage: node .e2e/mma-audit.mjs <subtype> <abs-file-path> [contextBlockIds csv]
import fs from 'node:fs';

const TOKEN = fs.readFileSync(process.env.HOME + '/.mma/auth-token', 'utf8').trim();
const PORT = 7337;
const CWD = '/Users/zhangzhixuan/Documents/code/mma-parent/multi-model-agent-forge';
const [subtype, file] = process.argv.slice(2);
if (!subtype || !file) { console.error('usage: mma-audit.mjs <subtype> <abs-file>'); process.exit(2); }

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'X-MMA-Client': 'claude-code',
  'X-MMA-Main-Model': 'claude-opus-4-8',
  'Content-Type': 'application/json',
};

const res = await fetch(`http://127.0.0.1:${PORT}/task?cwd=${encodeURIComponent(CWD)}`, {
  method: 'POST', headers,
  body: JSON.stringify({ type: 'audit', subtype, target: { paths: [file] } }),
});
if (!res.ok) { console.error('dispatch failed', res.status, await res.text()); process.exit(1); }
const { taskId } = await res.json();
console.log('taskId:', taskId, '| subtype:', subtype, '| file:', file.split('/').pop());

const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
let delay = 2000; const start = Date.now();
while (Date.now() - start < 555000) {
  const r = await fetch(`http://127.0.0.1:${PORT}/task/${taskId}`, { headers });
  if (r.status === 200) {
    const env = await r.json();
    const out = env.output || {};
    const findings = (out.findings || []).slice().sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
    console.log('\n=== SUMMARY ===');
    console.log(typeof out.summary === 'string' ? out.summary : JSON.stringify(out.summary, null, 2));
    console.log(`\n=== FINDINGS (${findings.length}) ===`);
    for (const f of findings) {
      console.log(`\n[${(f.severity || '?').toUpperCase()}] ${f.id || ''} ${f.category || ''}: ${f.claim || ''}`);
      if (f.evidence) console.log(`   evidence: ${String(f.evidence).replace(/\n/g, ' ').slice(0, 240)}`);
      if (f.suggestion) console.log(`   fix: ${String(f.suggestion).replace(/\n/g, ' ').slice(0, 240)}`);
    }
    if (env.error) console.log('\nERROR:', JSON.stringify(env.error));
    console.log(`\ncontextBlockId: ${env.contextBlockId ?? out.contextBlockId ?? 'n/a'}`);
    const counts = findings.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {});
    console.log('counts:', JSON.stringify(counts));
    process.exit(0);
  } else if (r.status === 202) {
    process.stdout.write('.');
    await new Promise((s) => setTimeout(s, delay));
    delay = Math.min(delay * 1.5, 15000);
  } else {
    console.error('\npoll error', r.status, await r.text()); process.exit(1);
  }
}
console.error('\npoll timeout'); process.exit(124);
