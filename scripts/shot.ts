import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member } from '@/db/schema';
import { PostgresSessionStore } from '@/auth/session-store';
import { SESSION_COOKIE_NAME } from '@/auth/config';
import puppeteer from 'puppeteer';
async function main() {
  const db = getDb();
  const admin = (await db.select().from(member).where(eq(member.username, 'admin')).limit(1))[0];
  const { token } = await new PostgresSessionStore().create(admin.id);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1500, deviceScaleFactor: 1 });
  await page.setCookie({ name: SESSION_COOKIE_NAME, value: token, domain: '127.0.0.1', path: '/' });
  await page.goto('http://127.0.0.1:3100/styleguide', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: '/tmp/forge-styleguide.png' });
  console.log('saved');
  await browser.close();
}
main().catch((e) => { console.error('SHOT ERROR:', (e as Error).message); process.exit(1); });
