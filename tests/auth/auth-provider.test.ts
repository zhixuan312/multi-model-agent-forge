// @vitest-environment node
import { LocalAuthProvider } from '@/auth/auth-provider';
import { LOGIN_TIMING_DELTA_MS } from './timing-bound';
import { seedTestMember, cleanupTestMembers, closeDb } from './db-fixtures';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('LocalAuthProvider.authenticate (live DB)', () => {
  const provider = new LocalAuthProvider();
  let username: string;
  let password: string;
  let memberId: string;

  beforeAll(async () => {
    const m = await seedTestMember({ label: 'authprov', password: 'right-password-1234' });
    username = m.username;
    password = m.password;
    memberId = m.id;
  });
  afterAll(async () => {
    await cleanupTestMembers();
    await closeDb();
  });

  it('valid creds → the member', async () => {
    const res = await provider.authenticate(username, password);
    expect(res?.id).toBe(memberId);
    expect(res?.username).toBe(username);
  });

  it('unknown user → null (no enumeration)', async () => {
    expect(await provider.authenticate('__forge_test__nobody_here', password)).toBeNull();
  });

  it('wrong password → null', async () => {
    expect(await provider.authenticate(username, 'wrong-password-xxxx')).toBeNull();
  });

  it('username match is case-insensitive', async () => {
    const res = await provider.authenticate(username.toUpperCase(), password);
    expect(res?.id).toBe(memberId);
  });

  it('timing-equality: median(unknown-user) ≈ median(wrong-password) within LOGIN_TIMING_DELTA_MS', async () => {
    const N = 20;
    const sample = async (user: string, pass: string): Promise<number> => {
      const t0 = performance.now();
      await provider.authenticate(user, pass);
      return performance.now() - t0;
    };
    const median = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < N; i++) {
      unknown.push(await sample('__forge_test__ghost_user', password));
      wrong.push(await sample(username, 'definitely-not-it-1234'));
    }
    expect(Math.abs(median(unknown) - median(wrong))).toBeLessThanOrEqual(LOGIN_TIMING_DELTA_MS);
  });
});
