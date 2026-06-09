// @vitest-environment node
// argon2 is native Node code; jsdom's realm is unnecessary and slower here.
import {
  hashPassword,
  verifyPassword,
  passwordSchema,
  DUMMY_ARGON2_HASH,
  ARGON2_OPTS,
} from '@/auth/password';
import { ARGON2_MEMORY_KIB, ARGON2_ITERATIONS, ARGON2_PARALLELISM, PASSWORD_MIN_LENGTH } from '@/auth/config';

describe('hashPassword / verifyPassword', () => {
  it('round-trips: a hashed password verifies', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('a wrong password fails verify', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Tr0ub4dor&3-nope', hash)).toBe(false);
  });

  it('uses the configured argon2id params (encoded in the hash)', async () => {
    // @node-rs/argon2 emits a PHC string: $argon2id$v=19$m=<mem>,t=<iter>,p=<par>$...
    const hash = await hashPassword('params-probe-password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain(`m=${ARGON2_MEMORY_KIB}`);
    expect(hash).toContain(`t=${ARGON2_ITERATIONS}`);
    expect(hash).toContain(`p=${ARGON2_PARALLELISM}`);
    expect(ARGON2_OPTS.memoryCost).toBe(ARGON2_MEMORY_KIB);
    expect(ARGON2_OPTS.timeCost).toBe(ARGON2_ITERATIONS);
    expect(ARGON2_OPTS.parallelism).toBe(ARGON2_PARALLELISM);
  });

  it('the precomputed dummy hash is a real, verifiable argon2id hash with the configured params', async () => {
    expect(DUMMY_ARGON2_HASH.startsWith('$argon2id$')).toBe(true);
    expect(DUMMY_ARGON2_HASH).toContain(`m=${ARGON2_MEMORY_KIB}`);
    // verifying any password against the dummy hash returns false but pays the full KDF cost
    expect(await verifyPassword('anything', DUMMY_ARGON2_HASH)).toBe(false);
  });
});

describe('passwordSchema (shared create/reset/change validation)', () => {
  it('rejects empty', () => {
    expect(passwordSchema.safeParse('').success).toBe(false);
  });

  it(`rejects below PASSWORD_MIN_LENGTH (${PASSWORD_MIN_LENGTH})`, () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
  });

  it('accepts a password at the minimum length', () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
  });
});
