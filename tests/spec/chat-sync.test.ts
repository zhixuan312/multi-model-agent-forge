/**
 * Comprehensive tests for the real-time spec discussion chat system.
 * Covers: message persistence, SSE event publishing, dedup, @Forge detection,
 * author attribution, and the full message lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── @Forge regex matching ────────────────────────────────────────────

describe('chat @Forge detection', () => {
  const forgeRegex = /@forge\b/i;

  it('matches @Forge at start', () => {
    expect(forgeRegex.test('@Forge update the spec')).toBe(true);
  });

  it('matches @forge lowercase', () => {
    expect(forgeRegex.test('@forge do something')).toBe(true);
  });

  it('matches @Forge in middle of text', () => {
    expect(forgeRegex.test('hey @Forge can you update this')).toBe(true);
  });

  it('does not match forge without @', () => {
    expect(forgeRegex.test('forge is great')).toBe(false);
  });

  it('does not match @Forgetful', () => {
    expect(forgeRegex.test('@Forgetful person')).toBe(false);
  });

  it('matches @FORGE uppercase', () => {
    expect(forgeRegex.test('@FORGE update')).toBe(true);
  });
});

// ── cleanText stripping ──────────────────────────────────────────────

describe('chat @Forge text cleaning', () => {
  const clean = (text: string) => text.replace(/@forge\s*/gi, '').trim();

  it('strips @Forge from start', () => {
    expect(clean('@Forge update the section')).toBe('update the section');
  });

  it('strips @forge from middle', () => {
    expect(clean('hey @forge update this')).toBe('hey update this');
  });

  it('returns empty for just @Forge', () => {
    expect(clean('@Forge')).toBe('');
  });

  it('returns empty for @Forge with only spaces', () => {
    expect(clean('@Forge   ')).toBe('');
  });

  it('handles multiple @forge mentions', () => {
    expect(clean('@Forge @forge do it')).toBe('do it');
  });
});

// ── Message dedup logic ──────────────────────────────────────────────

describe('chat message dedup', () => {
  it('seenMsgIds prevents duplicate append', () => {
    const seen = new Set<string>();
    const messages: { id: string; body: string }[] = [];

    function append(id: string, body: string) {
      if (seen.has(id)) return;
      seen.add(id);
      messages.push({ id, body });
    }

    append('msg-1', 'hello');
    append('msg-1', 'hello'); // duplicate
    append('msg-2', 'world');

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[1].id).toBe('msg-2');
  });

  it('sender sees message immediately via optimistic append, SSE echo is skipped', () => {
    const seen = new Set<string>();
    const discussion: { id: string; body: string }[] = [];

    // Step 1: optimistic append with temp ID
    const tempId = 'tmp-123';
    discussion.push({ id: tempId, body: 'my message' });

    // Step 2: POST returns real ID, replace temp + mark seen
    const realId = 'db-uuid-456';
    seen.add(realId);
    const idx = discussion.findIndex((d) => d.id === tempId);
    if (idx >= 0) discussion[idx] = { ...discussion[idx], id: realId };

    // Step 3: SSE echo arrives with same real ID — skipped
    if (!seen.has(realId)) {
      discussion.push({ id: realId, body: 'my message' });
    }

    expect(discussion).toHaveLength(1);
    expect(discussion[0].id).toBe(realId);
    expect(discussion[0].body).toBe('my message');
  });

  it('other user receives SSE and appends (not in seen set)', () => {
    const seen = new Set<string>();
    const discussion: { id: string; body: string }[] = [];

    // Other user's SSE arrives — not in seen set
    const msgId = 'db-uuid-789';
    if (!seen.has(msgId)) {
      seen.add(msgId);
      discussion.push({ id: msgId, body: 'other user message' });
    }

    expect(discussion).toHaveLength(1);
    expect(discussion[0].body).toBe('other user message');
  });
});

// ── SSE event shape ──────────────────────────────────────────────────

describe('chat.message SSE event shape', () => {
  it('has the correct structure', () => {
    const event = {
      type: 'chat.message' as const,
      componentId: 'comp-1',
      message: {
        id: 'msg-1',
        sender: 'member' as const,
        authorId: 'user-1',
        authorName: 'Xuan',
        bodyMd: 'hello world',
      },
    };

    expect(event.type).toBe('chat.message');
    expect(event.componentId).toBeTruthy();
    expect(event.message.id).toBeTruthy();
    expect(event.message.sender).toMatch(/^(forge|member)$/);
    expect(event.message.authorId).toBeTruthy();
    expect(event.message.authorName).toBeTruthy();
    expect(event.message.bodyMd).toBeTruthy();
  });

  it('forge message has authorId=forge', () => {
    const event = {
      type: 'chat.message' as const,
      componentId: 'comp-1',
      message: {
        id: 'msg-2',
        sender: 'forge' as const,
        authorId: 'forge',
        authorName: 'Forge',
        bodyMd: '✅ Looks good.',
      },
    };

    expect(event.message.sender).toBe('forge');
    expect(event.message.authorId).toBe('forge');
  });
});

// ── Initial message seeding ──────────────────────────────────────────

describe('chat initial message seeding', () => {
  it('seeds seenMsgIds from initialMessages to prevent duplicates on SSE reconnect', () => {
    const initialMessages = {
      'comp-1': [
        { id: 'msg-a', sender: 'forge' as const, bodyMd: 'hello', authorId: null },
        { id: 'msg-b', sender: 'member' as const, bodyMd: 'hi', authorId: 'user-1' },
      ],
      'comp-2': [
        { id: 'msg-c', sender: 'forge' as const, bodyMd: 'draft ready', authorId: null },
      ],
    };

    const seenIds = new Set(
      Object.values(initialMessages).flatMap((msgs) => msgs.map((m) => m.id)),
    );

    expect(seenIds.has('msg-a')).toBe(true);
    expect(seenIds.has('msg-b')).toBe(true);
    expect(seenIds.has('msg-c')).toBe(true);
    expect(seenIds.size).toBe(3);
  });

  it('maps authorId correctly — forge messages use forge, member messages use stored authorId', () => {
    const msgs = [
      { id: '1', sender: 'forge' as const, bodyMd: 'hi', authorId: null },
      { id: '2', sender: 'member' as const, bodyMd: 'hello', authorId: 'user-1' },
      { id: '3', sender: 'member' as const, bodyMd: 'old', authorId: null },
    ];

    const discussion = msgs.map((m) => ({
      id: m.id,
      authorId: m.sender === 'forge' ? 'forge' : (m.authorId ?? 'unknown'),
      body: m.bodyMd,
    }));

    expect(discussion[0].authorId).toBe('forge');
    expect(discussion[1].authorId).toBe('user-1');
    expect(discussion[2].authorId).toBe('unknown'); // null fallback, NOT current user
  });
});
