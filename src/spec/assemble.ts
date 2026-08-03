import { readSpecFile } from '@/projects/project-files';

/**
 * The latest spec from disk — file-based, not DB. It took a leading `db` argument it
 * never used, left from when the spec lived in a table; one caller had already resorted
 * to passing `null`.
 */
export async function getLatestSpec(projectId: string): Promise<{ version: number; bodyMd: string } | null> {
  const file = await readSpecFile(projectId);
  if (!file) return null;
  return { version: file.version, bodyMd: file.bodyMd };
}
