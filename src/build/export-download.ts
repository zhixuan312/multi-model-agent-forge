import { getDb, type Db } from '@/db/client';
import { exportRecord } from '@/db/schema/build';
import { assertProjectReadable, type ProjectActor } from '@/projects/projects-core';
import {
  readExplorationFile,
  readSpecFile,
  readPlanFile,
  readJournalFile,
} from '@/projects/project-files';

export interface DownloadResult {
  fileName: string;
  bodyMd: string;
  exportId: string;
}

export class ArtifactNotFoundError extends Error {
  constructor(kind: string) {
    super(`No ${kind} artifact to download.`);
    this.name = 'ArtifactNotFoundError';
  }
}

type DownloadableKind = 'exploration' | 'spec' | 'plan' | 'journal';

function readArtifactFile(projectId: string, kind: DownloadableKind): { bodyMd: string; version: number } | null {
  if (kind === 'exploration') {
    const file = readExplorationFile(projectId);
    return file ? { bodyMd: file.bodyMd, version: file.version } : null;
  }
  if (kind === 'spec') {
    const file = readSpecFile(projectId);
    return file ? { bodyMd: file.bodyMd, version: file.version } : null;
  }
  if (kind === 'plan') {
    const file = readPlanFile(projectId);
    return file ? { bodyMd: file.bodyMd, version: file.version } : null;
  }
  if (kind === 'journal') {
    const file = readJournalFile(projectId);
    return file ? { bodyMd: file.bodyMd, version: file.version } : null;
  }
  return null;
}

export async function downloadStageArtifact(
  args: { projectId: string; kind: DownloadableKind; actor: ProjectActor },
  deps: { db?: Db } = {},
): Promise<DownloadResult> {
  const db = deps.db ?? getDb();
  await assertProjectReadable(args.projectId, args.actor, { db });

  const art = readArtifactFile(args.projectId, args.kind);
  if (!art) throw new ArtifactNotFoundError(args.kind);

  const fileName = `${args.kind}-v${art.version}.md`;
  const [row] = await db
    .insert(exportRecord)
    .values({
      projectId: args.projectId,
      artifactKind: args.kind,
      artifactVersion: art.version,
      format: 'md',
      filePath: fileName,
      createdBy: args.actor.id,
    })
    .returning({ id: exportRecord.id });

  return { fileName, bodyMd: art.bodyMd, exportId: row.id };
}
