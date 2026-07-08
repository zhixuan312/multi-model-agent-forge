// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

let visible = true;
vi.mock('@/projects/projects-core', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    assertProjectReadable: async () => {
      if (!visible) {
        const { ProjectAccessError } = actual as { ProjectAccessError: new () => Error };
        throw new ProjectAccessError();
      }
    },
  };
});

const { GET } = await import('../../app/api/projects/[id]/events/route');
const { projectEventBus } = await import('@/sse/event-bus');

function asMember(): AuthedMember {
  return { id: 'm', username: 'mem', displayName: 'M', avatarTint: '#000', role: 'member', teamId: 'team-1' };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('SSE events route', () => {
  beforeEach(() => {
    mockCaller = asMember();
    visible = true;
  });

  it('exports dynamic=force-dynamic and the nodejs runtime', async () => {
    const mod = await import('../../app/api/projects/[id]/events/route');
    expect(mod.dynamic).toBe('force-dynamic');
    expect(mod.runtime).toBe('nodejs');
  });

  it('401 for an anonymous request', async () => {
    mockCaller = null;
    const res = await GET(new Request('http://localhost/api/projects/p1/events'), params('p1'));
    expect(res.status).toBe(401);
  });

  it('404 for a non-collaborator on a private project (Spec 3 visibility)', async () => {
    visible = false;
    const res = await GET(new Request('http://localhost/api/projects/p1/events'), params('p1'));
    expect(res.status).toBe(404);
  });

  it('sets the SSE headers and streams a published event then heartbeats', async () => {
    const ctrl = new AbortController();
    const res = await GET(new Request('http://localhost/api/projects/p1/events', { signal: ctrl.signal }), params('p1'));
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    // Allow the stream `start` to run and subscribe.
    await new Promise((r) => setTimeout(r, 10));
    projectEventBus.publish('p1', { type: 'task.done', taskId: 't', mmaBatchId: 'b', route: 'investigate', status: 'recorded' });
    const { value } = await reader.read();
    const text = dec.decode(value);
    expect(text).toContain('data: ');
    expect(text).toContain('task.done');

    // Abort closes the stream + unsubscribes (refcount teardown).
    ctrl.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(projectEventBus.subscriberCount('p1')).toBe(0);
    await reader.cancel().catch(() => {});
  });
});
