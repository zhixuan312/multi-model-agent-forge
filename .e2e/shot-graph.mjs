// Screenshot the journal knowledge graph: overview, hover card, fullscreen panel.
// Usage: node .e2e/shot-graph.mjs <outdir>
import puppeteer from 'puppeteer';
import postgres from 'postgres';
import crypto from 'node:crypto';
import { BASE, DB } from './e2e-lib.mjs';

// The lib's MEMBER is the org admin, whom the journal redirects to /usage —
// mint for the team admin instead.
async function mintTeamSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sql = postgres(DB);
  try {
    await sql`insert into forge.team_session (member_id, token_hash, expires_at, last_used_at) values ('0590aa12-7305-4996-8ac4-d02ef9a888a6', ${tokenHash}, ${new Date(Date.now() + 86400000)}, ${new Date()})`;
  } finally { await sql.end(); }
  return token;
}

const outdir = process.argv[2] || '.e2e/out';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const token = await mintTeamSession();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1720, height: 1000, deviceScaleFactor: 1 });
  await page.setCookie({ name: 'forge_session', value: token, url: BASE });
  await page.goto(new URL('/journal?view=graph', BASE).href, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 8000)); // entrance (5s) + settle
  await page.screenshot({ path: `${outdir}/graph-1-overview.png` });

  // find the canvas rect
  const rect = await page.evaluate(() => {
    const c = document.querySelector('[aria-label="Journal knowledge graph"]');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  // sweep for a star: move+click until the hover/side card shows
  let hit = null;
  outer: for (let dy = -60; dy <= 200; dy += 30) {
    for (let dx = -260; dx <= 260; dx += 30) {
      const x = rect.x + rect.w / 2 + dx, y = rect.y + rect.h / 2 + dy;
      await page.mouse.move(x, y);
      await new Promise(r => setTimeout(r, 60));
      if (await page.$('[data-testid="graph-hover-card"]')) { hit = { x, y }; break outer; }
    }
  }
  console.log('hover hit:', JSON.stringify(hit));
  if (hit) {
    await new Promise(r => setTimeout(r, 700));
    await page.screenshot({ path: `${outdir}/graph-2-hover.png` });
  }

  // fullscreen: the canvas resizes, so re-sweep for a star before clicking
  await page.click('[data-testid="graph-fullscreen"]');
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: `${outdir}/graph-3-full-overview.png` });
  let panel = false;
  outer2: for (let dy = -160; dy <= 220; dy += 30) {
    for (let dx = -320; dx <= 320; dx += 30) {
      const x = 1720 / 2 + dx, y = 1000 / 2 + dy;
      await page.mouse.move(x, y);
      await new Promise(r => setTimeout(r, 50));
      if (await page.$('[data-testid="graph-hover-card"]')) {
        await page.mouse.click(x, y);
        await new Promise(r => setTimeout(r, 1800)); // camera turn + body fetch
        panel = !!(await page.$('[data-testid="graph-detail-panel"]'));
        break outer2;
      }
    }
  }
  console.log('panel open:', panel);
  await page.screenshot({ path: `${outdir}/graph-4-full-panel.png` });
} finally {
  await browser.close();
}
console.log('done');
