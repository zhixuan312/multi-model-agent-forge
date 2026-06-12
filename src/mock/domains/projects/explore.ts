import { findMockProject } from '@/mock/domains/projects/dashboard';
import type { AttachmentView } from '@/exploration/attachments';
import type { RailTask, ArtifactCacheEntry } from '@/hooks/useProjectEvents';

/**
 * Mock content for the Exploration stage (Spec 5) so the per-project flow is
 * walkable without a DB. A just-started project lands on a FRESH brain-dump
 * composer — an empty context box (no brief, no tasks, no synthesis yet) — which
 * is the first thing you do in a project: dump in all the context. Repo options
 * are provided so the composer's repo selector has choices.
 */
export interface MockExplore {
  projectName: string;
  brief: string;
  attachments: AttachmentView[];
  tasks: RailTask[];
  artifact: ArtifactCacheEntry | null;
  repoOptions: { id: string; name: string }[];
  voiceEnabled: boolean;
}

const REPO_OPTIONS = [
  { id: 'mock-repo-mma', name: 'multi-model-agent' },
  { id: 'mock-repo-forge', name: 'multi-model-agent-forge' },
  { id: 'mock-repo-infra', name: 'forge-infra' },
];

export function mockExplore(projectId: string): MockExplore {
  const proj = findMockProject(projectId);
  return {
    projectName: proj?.name ?? 'Project',
    // Fresh project → empty composer (the "put in all the context" box).
    brief: '',
    attachments: [],
    tasks: [],
    artifact: null,
    repoOptions: REPO_OPTIONS,
    voiceEnabled: true,
  };
}
