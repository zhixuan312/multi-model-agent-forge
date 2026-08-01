import { PASSWORD_MIN_LENGTH } from '@/auth/config';

/**
 * Client-safe password generation for the admin "Generate" affordance.
 *
 * Deliberately NOT in `@/auth/password`: that module imports `@node-rs/argon2`, and this one
 * is used from a `'use client'` component, so sharing a file would drag a native server
 * dependency into the browser bundle. `@/auth/config` is plain constants and is safe here.
 */

/** Ambiguous glyphs (0/O/1/l/I) are omitted so a generated password survives being read
 *  aloud or copied by hand. */
export const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * A random password of at least `PASSWORD_MIN_LENGTH`, UNIFORM over the alphabet.
 *
 * Rejection sampling, not `byte % length`. The alphabet has 54 characters and a byte has
 * 256 values; 256 is not a multiple of 54, so a plain modulo drew 40 of the characters from
 * five byte values each and the remaining 14 from four — making them 1.25x likelier. The
 * measured cost was small (91.98 bits of entropy over 16 characters instead of 92.08), so
 * this is correctness in a security primitive rather than a vulnerability being closed.
 * Discarding the non-uniform tail of the byte range makes every character equally likely.
 *
 * `getRandomValues` is refilled in a loop because rejected bytes leave the buffer short;
 * with a 54-character alphabet only 16 of 256 values (6.25%) are discarded, so in practice
 * this almost always completes on the first pass.
 */
export function generatePassword(randomBytes: (buf: Uint8Array) => void = (b) => crypto.getRandomValues(b)): string {
  const n = PASSWORD_ALPHABET.length;
  const len = Math.max(PASSWORD_MIN_LENGTH, 16);
  const limit = 256 - (256 % n); // largest multiple of n that fits in a byte
  const out: string[] = [];
  const buf = new Uint8Array(len);
  while (out.length < len) {
    randomBytes(buf);
    for (const b of buf) {
      if (b >= limit) continue; // non-uniform tail — draw again rather than fold it in
      out.push(PASSWORD_ALPHABET[b % n]);
      if (out.length === len) break;
    }
  }
  return out.join('');
}
