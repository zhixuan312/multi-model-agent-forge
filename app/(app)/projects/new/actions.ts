'use server';

import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { createProject } from '@/projects/projects-core';
import { stageRoute } from '@/projects/stage-route';

export interface NewProjectState {
  error?: { field?: 'name' | 'repoIds' | 'visibility'; message: string };
}

/**
 * New-project server action (Spec 3 flow 1, transport = server action only — no
 * POST /api/projects). Validates + creates in one transaction, then redirects to
 * the project's current stage (`/projects/<id>/explore`). On validation failure
 * returns a field-level error to the form (no row created).
 */
export async function createProjectAction(
  _prev: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const me = await currentMember();
  if (!me) redirect('/login');

  const name = String(formData.get('name') ?? '');
  const visibility = String(formData.get('visibility') ?? 'public');
  const repoIds = formData.getAll('repoIds').map((v) => String(v));

  const res = await createProject({ name, visibility, repoIds }, { id: me.id });
  if (!res.ok) {
    return { error: res.error };
  }
  redirect(stageRoute('exploration', res.id));
}
