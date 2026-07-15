import { describe, it, expect, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/auth/current-member', () => ({
  currentMember: vi.fn(async () => ({ id: 'member-1', role: 'member', teamId: 'team-1' })),
}));
vi.mock('@/auth/team-scope', () => ({
  projectActorFromMember: vi.fn(() => ({ id: 'member-1', teamId: 'team-1' })),
}));
vi.mock('@/projects/projects-core', () => ({
  createProject: vi.fn(async () => ({ ok: true, id: 'proj-1', entryStage: 'plan' })),
}));

import { createProjectAction } from '../../app/(app)/projects/new/actions';

describe('createProjectAction', () => {
  it('passes selected stages and uploaded artifact through to createProject', async () => {
    const formData = new FormData();
    formData.set('name', 'Subset');
    formData.set('visibility', 'public');
    formData.append('repoIds', '00000000-0000-4000-8000-000000000001');
    formData.append('selectedDesignStages', 'plan');
    formData.set('artifactData', Buffer.from('## Context').toString('base64'));
    formData.set('artifactName', 'spec.md');

    await expect(createProjectAction({}, formData)).rejects.toThrow('REDIRECT:/projects/proj-1/plan');
  });

  it('rejects a non-UTF-8 (binary) upload at the boundary without redirecting (FR-18)', async () => {
    const { createProject } = await import('@/projects/projects-core');
    (createProject as unknown as { mockClear: () => void }).mockClear();
    redirect.mockClear();
    const formData = new FormData();
    formData.set('name', 'Subset');
    formData.set('visibility', 'public');
    formData.append('repoIds', '00000000-0000-4000-8000-000000000001');
    formData.append('selectedDesignStages', 'plan');
    // Invalid UTF-8 bytes → decodeUploadedArtifact throws → action returns error, no redirect.
    formData.set('artifactData', Buffer.from(new Uint8Array([0xff, 0xfe, 0xfd])).toString('base64'));
    formData.set('artifactName', 'spec.md');

    const res = await createProjectAction({}, formData);
    expect(res).toEqual({ error: { field: 'artifact', message: 'file failed to load or parse — re-upload' } });
    expect(createProject).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
