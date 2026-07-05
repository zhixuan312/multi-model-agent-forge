// Screenshot a project's read-only Activity overlay (clicks the topbar "Activity").
// Usage: node .e2e/shot-activity.mjs <projectId> <stage> <outfile>
import puppeteer from 'puppeteer';
import { mintSession, BASE } from './e2e-lib.mjs';

const PID = process.argv[2] || '02378477-1808-4f45-9b3c-35ba8e0b5d38';
const stage = process.argv[3] || 'journal';
const out = process.argv[4] || '/private/tmp/claude-501/-Users-zhangzhixuan-Documents-code-mma-parent/bef3934f-5f27-4ad5-9610-7d71866a7455/scratchpad/activity.png';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const token = await mintSession();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  await page.setCookie({ name: 'forge_session', value: token, url: BASE });
  await page.goto(`${BASE}/projects/${PID}/${stage}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000)); // hydration
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /^\s*Activity\s*$/.test(b.textContent || ''));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: out, fullPage: false });
  console.log('clicked Activity:', clicked, '->', out);
} finally { await browser.close(); }
