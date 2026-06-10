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
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1380, height: 920 });
  await page.setCookie({ name: SESSION_COOKIE_NAME, value: token, domain: '127.0.0.1', path: '/' });
  for (const [path, name] of [['/workspace','workspace'],['/projects','projects'],['/settings/members','settings']]) {
    await page.goto('http://127.0.0.1:3100'+path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1800));
    await page.screenshot({ path: '/tmp/forge-'+name+'.png' });
    console.log('saved', name);
  }
  await browser.close();
}
main().catch((e) => { console.error('ERR', (e as Error).message); process.exit(1); });
