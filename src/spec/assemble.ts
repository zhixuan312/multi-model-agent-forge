import { readSpecFileAsync } from '@/projects/project-files';

/** The latest spec from disk — file-based, not DB. */
export async function getLatestSpec(_db: unknown, projectId: string): Promise<{ version: number; bodyMd: string } | null> {
  const file = await readSpecFileAsync(projectId);
  if (!file) return null;
  return { version: file.version, bodyMd: file.bodyMd };
}
