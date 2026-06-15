// @vitest-environment node
import { vi, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthedMember } from '@/auth/auth-provider';
import { parseExportKind, mapExportError } from '@/export/route-helpers';
import { ArtifactNotReadyError } from '@/export/collect-artifacts';
import { SpecHeadingContractError } from '@/export/sections';
import {
  PdfTimeoutError,
  PdfTooLargeError,
  PdfQueueFullError,
  PdfEngineError,
} from '@/export/pdf/render';
import { NoComponentsSelectedError, NothingToExportError } from '@/export/service';
import { ProjectAccessError } from '@/projects/projects-core';
import {
  seedProject,
  seedArtifact,
  seedMember,
  cleanupExportFixtures,
} from './db-fixtures';

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

const artifactsRoute = await import('../../app/api/projects/[id]/export/artifacts/route');
const sectionsRoute = await import('../../app/api/projects/[id]/export/sections/route');
const mdRoute = await import('../../app/api/projects/[id]/export/md/route');

function asMember(id: string): AuthedMember {
  return { id, username: 'u', displayName: 'U', avatarTint: '#000', isAdmin: false };
}

afterAll(async () => {
  await cleanupExportFixtures();
});
beforeEach(() => {
  mockCaller = null;
});

const SPEC_BODY = '## 01. Context\nctx\n\n## 03. Technical design\ntech';

// Live-DB integration suite — gated OFF: tests never touch a database (no test DB
// exists; production must not be mutated). See tests/setup.ts.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('route helpers — kind validation (F27)', () => {
  it('accepts the four kinds, rejects exploration_brief + junk', () => {
    expect(parseExportKind('spec')).toBe('spec');
    expect(parseExportKind('exploration')).toBe('exploration');
    expect(parseExportKind('plan')).toBe('plan');
    expect(parseExportKind('review')).toBe('review');
    expect(parseExportKind('exploration_brief')).toBeNull();
    expect(parseExportKind('nope')).toBeNull();
  });
});

describe.skipIf(!hasDb)('route helpers — error → status mapping (F27, test 15)', () => {
  const cases: [unknown, number, string][] = [
    [new ProjectAccessError(), 403, 'forbidden'],
    [new ArtifactNotReadyError('plan'), 409, 'artifact_not_ready'],
    [new SpecHeadingContractError('x'), 409, 'spec_heading_contract_mismatch'],
    [new NothingToExportError(), 409, 'nothing_to_export'],
    [new NoComponentsSelectedError(), 422, 'no_components_selected'],
    [new PdfTooLargeError(), 413, 'export_too_large'],
    [new PdfQueueFullError(), 503, 'pdf_queue_full'],
    [new PdfTimeoutError(), 504, 'pdf_render_timeout'],
    [new PdfEngineError(), 500, 'pdf_engine_unavailable'],
  ];
  it.each(cases)('%s → status %i', async (err, status, code) => {
    const res = mapExportError(err)!;
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });
  it('returns null for a non-export error', () => {
    expect(mapExportError(new Error('random'))).toBeNull();
  });
});

describe.skipIf(!hasDb)('route modules — runtime config (F12, test 15)', () => {
  const mods = ['artifacts', 'sections', 'md', 'pdf', 'bundle'];
  it.each(mods)('%s route exports dynamic=force-dynamic + nodejs runtime', async (name) => {
    const mod = await import(`../../app/api/projects/[id]/export/${name}/route.ts`);
    expect(mod.dynamic).toBe('force-dynamic');
    expect(mod.runtime).toBe('nodejs');
  });
});

describe.skipIf(!hasDb)('GET /export/artifacts (Key flow A)', () => {
  it('401 without a session', async () => {
    const res = await artifactsRoute.GET(new NextRequest('http://x/a'), {
      params: Promise.resolve({ id: 'p' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns the menu model with ready/pending', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedArtifact(projectId, 'spec', SPEC_BODY);
    mockCaller = asMember(ownerId);
    const res = await artifactsRoute.GET(new NextRequest('http://x/a'), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const byKind = Object.fromEntries(body.artifacts.map((a: { kind: string }) => [a.kind, a]));
    expect(byKind.spec.ready).toBe(true);
    expect(byKind.review.ready).toBe(false);
  });

  it('403 for a non-collaborator on a private project', async () => {
    const { projectId } = await seedProject({ visibility: 'private' });
    const stranger = await seedMember('stranger');
    mockCaller = asMember(stranger.id);
    const res = await artifactsRoute.GET(new NextRequest('http://x/a'), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(403);
  });
});

describe.skipIf(!hasDb)('GET /export/sections (F30)', () => {
  it('returns [{NN,title}] for a spec', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedArtifact(projectId, 'spec', SPEC_BODY);
    mockCaller = asMember(ownerId);
    const res = await sectionsRoute.GET(new NextRequest('http://x/s?artifact=spec'), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sections).toEqual([
      { nn: '01', title: 'Context' },
      { nn: '03', title: 'Technical design' },
    ]);
  });

  it('returns [] for a non-spec kind (no parse)', async () => {
    const { projectId, ownerId } = await seedProject();
    mockCaller = asMember(ownerId);
    const res = await sectionsRoute.GET(new NextRequest('http://x/s?artifact=plan'), {
      params: Promise.resolve({ id: projectId }),
    });
    expect((await res.json()).sections).toEqual([]);
  });

  it('400 for an unknown kind', async () => {
    const res = await sectionsRoute.GET(new NextRequest('http://x/s?artifact=exploration_brief'), {
      params: Promise.resolve({ id: 'p' }),
    });
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!hasDb)('GET /export/md (Key flow B)', () => {
  it('streams text/markdown with a Content-Disposition attachment', async () => {
    const { projectId, ownerId } = await seedProject();
    await seedArtifact(projectId, 'spec', SPEC_BODY);
    mockCaller = asMember(ownerId);
    const res = await mdRoute.GET(new NextRequest('http://x/md?artifact=spec'), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('content-disposition')).toContain('specification.md');
    expect(await res.text()).toBe(SPEC_BODY);
  });

  it('409 artifact_not_ready for a pending artifact', async () => {
    const { projectId, ownerId } = await seedProject();
    mockCaller = asMember(ownerId);
    const res = await mdRoute.GET(new NextRequest('http://x/md?artifact=plan'), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('artifact_not_ready');
  });

  it('400 unknown_artifact_kind', async () => {
    const res = await mdRoute.GET(new NextRequest('http://x/md?artifact=exploration_brief'), {
      params: Promise.resolve({ id: 'p' }),
    });
    expect(res.status).toBe(400);
  });
});
