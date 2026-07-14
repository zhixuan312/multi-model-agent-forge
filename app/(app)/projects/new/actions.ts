'use server';

import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { createProject } from '@/projects/projects-core';
import { stageRoute } from '@/projects/stage-route';
import { CREATE_PROJECT_FILE_ERROR, decodeUploadedArtifact } from '@/projects/create-project-subset';

export interface NewProjectState {
  error?: {
    field?: 'name' | 'repoIds' | 'visibility' | 'selectedDesignStages' | 'artifact';
    message: string;
  };
}

/**
 * New-project server action (Spec 3 flow 1, transport = server action only — no
 * POST /api/projects). Validates + creates in one transaction, then redirects to
 * the chosen entry stage (`stageRoute(entryStage, id)`): Full SDLC and
 * exploration-start subsets enter at `/explore`, a spec-start subset at `/spec`, a
 * plan-start subset at `/plan`. On validation or upload-parse failure it returns a
 * field-level error to the form (no row created).
 */
export async function createProjectAction(
  _prev: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const me = await currentMember();
  if (!me) redirect('/login');
  const actor = projectActorFromMember(me);
  if (!actor) redirect('/');

  const name = String(formData.get('name') ?? '');
  const visibility = String(formData.get('visibility') ?? 'public');
  const repoIds = formData.getAll('repoIds').map((v) => String(v));
  const selectedDesignStages = formData.getAll('selectedDesignStages').map((v) => String(v));

  // Validate the raw upload bytes (size + strict UTF-8) at the boundary where the File
  // still exists — decoding via File.text() first would lossily replace invalid bytes and
  // defeat the binary-rejection guard (FR-18). Reject binary/oversized uploads here.
  const artifactFile = formData.get('artifact');
  let uploadedArtifact: { kind: 'exploration' | 'spec'; filename: string; content: string } | undefined;
  if (artifactFile instanceof File && artifactFile.size > 0) {
    let content: string;
    try {
      content = decodeUploadedArtifact(new Uint8Array(await artifactFile.arrayBuffer()));
    } catch {
      return { error: { field: 'artifact', message: CREATE_PROJECT_FILE_ERROR } };
    }
    uploadedArtifact = {
      kind: selectedDesignStages[0] === 'plan' ? 'spec' : 'exploration',
      filename: artifactFile.name,
      content,
    };
  }

  const res = await createProject({ name, visibility, repoIds, selectedDesignStages, uploadedArtifact }, actor);
  if (!res.ok) return { error: res.error };
  redirect(stageRoute(res.entryStage, res.id));
}
