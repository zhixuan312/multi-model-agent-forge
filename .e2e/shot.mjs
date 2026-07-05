// Screenshot the live project page (auto overlay) as xuan.
// Usage: node .e2e/shot.mjs [stage] [outfile]
import puppeteer from 'puppeteer';
import { mintSession, PID as DEFAULT_PID, BASE } from './e2e-lib.mjs';

const PID = process.env.SHOT_PID || DEFAULT_PID;
const stage = process.argv[2] || 'spec';
const out = process.argv[3] || '/private/tmp/claude-501/-Users-zhangzhixuan-Documents-code-mma-parent/bef3934f-5f27-4ad5-9610-7d71866a7455/scratchpad/overlay.png';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const token = await mintSession();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const url = new URL(`/projects/${PID}/${stage}`, BASE);
  await page.setCookie({ name: 'forge_session', value: token, url: BASE });
  await page.goto(url.href, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 3500)); // let SSE + hydration settle
  await page.screenshot({ path: out, fullPage: false });
  // Also dump the visible activity-log text for a quick sanity read
  const logText = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('*')).find(el => /Activity/.test(el.textContent || '') && el.querySelector);
    const lines = Array.from(document.querySelectorAll('[class*="font-mono"], .text-sm'))
      .map(e => (e.textContent || '').trim()).filter(Boolean);
    return lines.slice(0, 40).join('\n');
  });
  console.log('SHOT', out);
  console.log('---LOG-TEXT---');
  console.log(logText);
} finally {
  await browser.close();
}
