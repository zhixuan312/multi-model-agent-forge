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
    formData.set('artifact', new File(['## Context'], 'spec.md', { type: 'text/markdown' }));

    await expect(createProjectAction({}, formData)).rejects.toThrow('REDIRECT:/projects/proj-1/plan');
  });
});
