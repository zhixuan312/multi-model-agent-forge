// @vitest-environment node
import { mentionSpans, parseMentions } from '@/collab/mentions';
import type { MemberRef } from '@/collab/types';

const bo: MemberRef = { id: 'bo', displayName: 'Bo Chen', avatarTint: '#355a74' };
const priya: MemberRef = { id: 'priya', displayName: 'Priya Nair', avatarTint: '#b23a48' };
const shortBo: MemberRef = { id: 'bo2', displayName: 'Bo', avatarTint: '#000' };
const pool = [bo, priya, shortBo];

describe('parseMentions', () => {
  it('resolves a single @-mention by display name', () => {
    expect(parseMentions('hey @Priya Nair can you check this', pool).map((m) => m.id)).toEqual(['priya']);
  });

  it('matches the longest name first so "@Bo Chen" is not also read as "@Bo"', () => {
    expect(parseMentions('ping @Bo Chen please', pool).map((m) => m.id)).toEqual(['bo']);
  });

  it('still resolves a bare "@Bo" to the short-named member', () => {
    expect(parseMentions('ping @Bo please', pool).map((m) => m.id)).toEqual(['bo2']);
  });

  it('resolves multiple distinct mentions', () => {
    expect(parseMentions('@Bo Chen and @Priya Nair', pool).map((m) => m.id).sort()).toEqual(['bo', 'priya']);
  });

  it('is case-insensitive and ignores unresolvable text', () => {
    expect(parseMentions('@bo chen and @Nobody Here', pool).map((m) => m.id)).toEqual(['bo']);
  });

  it('returns nothing when there are no mentions', () => {
    expect(parseMentions('just a plain comment', pool)).toEqual([]);
  });

  it('lists a member once even when mentioned twice', () => {
    expect(parseMentions('@Bo Chen ping @Bo Chen again', pool).map((m) => m.id)).toEqual(['bo']);
  });

  it('returns members in the order they appear in the text', () => {
    expect(parseMentions('@Priya Nair then @Bo Chen', pool).map((m) => m.id)).toEqual(['priya', 'bo']);
  });
});

/**
 * `mentionSpans` is the shared core. Both these rules were previously enforced only on the
 * participant-resolution side; the thread renderer had its own regex that applied neither,
 * so a mention could be resolved-but-not-highlighted (case) or highlighted-but-not-resolved
 * (prefix). They are one implementation now, so these cases pin BOTH surfaces.
 */
describe('mentionSpans — the rules the renderer used to get wrong', () => {
  it('does not match a name inside a longer @-token (@Bo must not match @Bobby)', () => {
    // Only "Bo" is in the pool; "@Bobby" is somebody else entirely.
    expect(mentionSpans('ping @Bobby now', [shortBo])).toEqual([]);
  });

  it('matches regardless of the casing the author typed', () => {
    const spans = mentionSpans('hey @bo chen', pool);
    expect(spans.map((s) => s.member.id)).toEqual(['bo']);
    // The literal keeps the author's casing so the rendered text is unchanged.
    expect(spans[0].text).toBe('@bo chen');
  });

  it('reports the exact character range, so a renderer can splice around it', () => {
    const body = 'hi @Bo Chen!';
    const [span] = mentionSpans(body, pool);
    expect(body.slice(span.start, span.end)).toBe('@Bo Chen');
    expect(span.start).toBe(3);
  });

  it('never overlaps two spans on the same characters', () => {
    const spans = mentionSpans('@Bo Chen', pool);
    expect(spans).toHaveLength(1);
    expect(spans[0].member.id).toBe('bo');
  });

  it('returns spans in text order even though matching is longest-name-first', () => {
    const spans = mentionSpans('@Bo and @Priya Nair and @Bo Chen', pool);
    expect(spans.map((s) => s.start)).toEqual([...spans.map((s) => s.start)].sort((a, b) => a - b));
    expect(spans.map((s) => s.member.id)).toEqual(['bo2', 'priya', 'bo']);
  });

  it('treats a name with regex metacharacters literally', () => {
    const odd: MemberRef = { id: 'odd', displayName: 'A.B (C)', avatarTint: '#111' };
    expect(mentionSpans('hey @A.B (C) there', [odd]).map((s) => s.member.id)).toEqual(['odd']);
    expect(mentionSpans('hey @AXB (C) there', [odd])).toEqual([]);
  });

  it('ignores a pool member with an empty display name instead of matching every @', () => {
    const blank: MemberRef = { id: 'blank', displayName: '', avatarTint: '#222' };
    expect(mentionSpans('an @ sign and @Bo', [blank, shortBo]).map((s) => s.member.id)).toEqual(['bo2']);
  });
});
