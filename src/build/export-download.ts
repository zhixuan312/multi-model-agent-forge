import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { exportRecord } from '@/db/schema/build';
import { assertProjectReadable, type ProjectActor } from '@/projects/projects-core';
import type { ArtifactKind } from '@/db/enums';

/**
 * Per-stage raw-markdown download (Spec 7 §In-scope F8/F23; the ONLY `export`
 * path exercised here). Streams the latest `artifact(kind)`'s `body_md` as a
 * `text/markdown` attachment, writes ONE `export(format='md')` row with a
 * SYNTHETIC served filename `<kind>-v<version>.md` (no on-disk file), and respects
 * the Spec 3 private/public artifact-visibility rule (guard FIRST). PDF/bundle
 * stay out of scope (Spec 8).
 */

export interface DownloadResult {
  fileName: string; // <kind>-v<version>.md
  bodyMd: string;
  exportId: string;
}

export class ArtifactNotFoundError extends Error {
  constructor(kind: string) {
    super(`No ${kind} artifact to download.`);
    this.name = 'ArtifactNotFoundError';
  }
}

/**
 * Resolve the latest artifact of `kind`, enforce visibility, insert ONE export
 * row, and return the body + synthetic filename for streaming. Throws
 * `ProjectAccessError` (visibility) before any read of a private artifact, and
 * `ArtifactNotFoundError` when no such artifact exists.
 */
export async function downloadStageArtifact(
  args: { projectId: string; kind: ArtifactKind; actor: ProjectActor },
  deps: { db?: Db } = {},
): Promise<DownloadResult> {
  const db = deps.db ?? getDb();

  // Guard FIRST — a private artifact is rejected for an unauthorized member.
  await assertProjectReadable(args.projectId, args.actor, { db });

  const [art] = await db
    .select({ id: artifact.id, bodyMd: artifact.bodyMd, version: artifact.version })
    .from(artifact)
    .where(and(eq(artifact.projectId, args.projectId), eq(artifact.kind, args.kind)))
    .orderBy(desc(artifact.version))
    .limit(1);
  if (!art) throw new ArtifactNotFoundError(args.kind);

  const fileName = `${args.kind}-v${art.version}.md`;
  const [row] = await db
    .insert(exportRecord)
    .values({
      projectId: args.projectId,
      artifactId: art.id,
      format: 'md',
      filePath: fileName, // SYNTHETIC served filename; no on-disk file written
      createdBy: args.actor.id,
    })
    .returning({ id: exportRecord.id });

  return { fileName, bodyMd: art.bodyMd, exportId: row.id };
}
