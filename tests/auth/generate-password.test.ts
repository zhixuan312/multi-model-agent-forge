// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { generatePassword, PASSWORD_ALPHABET } from '@/auth/generate-password';
import { PASSWORD_MIN_LENGTH } from '@/auth/config';

/**
 * The generator used to map a random byte with `b % alphabet.length`. The alphabet has 54
 * characters and a byte has 256 values, and 256 is not a multiple of 54, so 40 characters
 * were drawn from five byte values each and the other 14 from four — leaving them 1.25x
 * likelier. Measured cost: 91.98 bits of entropy over 16 characters instead of 92.08. Small,
 * but a textbook flaw in a security primitive, so these lock the uniform behaviour.
 */
describe('generatePassword', () => {
  it('meets the configured minimum length and uses only alphabet characters', () => {
    const pw = generatePassword();
    expect(pw.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
    expect(pw.length).toBeGreaterThanOrEqual(16);
    for (const ch of pw) expect(PASSWORD_ALPHABET).toContain(ch);
  });

  it('omits glyphs that are ambiguous when read aloud or copied by hand', () => {
    for (const ch of '0O1lI') expect(PASSWORD_ALPHABET).not.toContain(ch);
  });

  it('DISCARDS the non-uniform tail of the byte range instead of folding it in', () => {
    // 256 % 54 = 40, so 216 is the largest usable multiple and bytes 216..255 must be
    // rejected. Feed a byte in that tail followed by a known-good one: a modulo
    // implementation would emit PASSWORD_ALPHABET[240 % 54]; rejection sampling skips it.
    const scripted = [240, 0];
    let i = 0;
    const pw = generatePassword((buf) => {
      for (let k = 0; k < buf.length; k++) buf[k] = scripted[i++ % scripted.length];
    });
    expect(pw[0]).toBe(PASSWORD_ALPHABET[0]);
    expect(pw[0]).not.toBe(PASSWORD_ALPHABET[240 % PASSWORD_ALPHABET.length]);
  });

  it('still terminates when almost every byte is rejected', () => {
    // A generator that only refilled once would return a short password here.
    let call = 0;
    const pw = generatePassword((buf) => {
      call += 1;
      // First few passes are entirely rejectable bytes; then all-zero.
      buf.fill(call < 4 ? 255 : 0);
    });
    expect(pw.length).toBeGreaterThanOrEqual(16);
  });

  it('shows no trace of the modulo bias across many draws', () => {
    // Test the bias DIRECTLY rather than max/min, whose sampling noise (~±15% here) is the
    // same order as the 1.25 effect and so cannot separate them. `b % 54` drew indices
    // 0..39 from five byte values and 40..53 from four, so those two groups had a 1.25
    // frequency ratio by construction. Averaging within each group shrinks the noise to
    // ~±1.3%, which discriminates cleanly.
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++) for (const ch of generatePassword()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(PASSWORD_ALPHABET.length);

    const at = (i: number) => counts.get(PASSWORD_ALPHABET[i]) ?? 0;
    const mean = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += at(i);
      return sum / (to - from);
    };
    const favoured = mean(0, 256 % PASSWORD_ALPHABET.length);            // 0..39 under modulo
    const starved = mean(256 % PASSWORD_ALPHABET.length, PASSWORD_ALPHABET.length); // 40..53
    expect(favoured / starved).toBeGreaterThan(0.95);
    expect(favoured / starved).toBeLessThan(1.05);
  });

  it('does not repeat across calls', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });
});
