import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { teamSpecTemplate } from '@/db/schema/team';
import { SPEC_TEMPLATE_SEEDS } from '@/db/seed/team-spec-template';
import { parseSpecSections } from '@/spec/spec-file-ops';
import type { UploadedSpecProof } from '@/details/schema';

export const CREATE_PROJECT_FILE_ERROR = 'file failed to load or parse — re-upload';
export const MAX_UPLOAD_BYTES = 300_000;
export const VALID_SUBSET_RUNS = [
  ['exploration'],
  ['spec'],
  ['plan'],
  ['exploration', 'spec'],
  ['spec', 'plan'],
  ['exploration', 'spec', 'plan'],
] as const;

export type DesignStageSelection = 'exploration' | 'spec' | 'plan';

export function validateSubsetSelection(selected: readonly DesignStageSelection[]) {
  if (selected.length === 0) return { ok: true } as const;
  const signature = selected.join(',');
  const valid = VALID_SUBSET_RUNS.some((run) => run.join(',') === signature);
  return valid
    ? { ok: true } as const
    : { ok: false, message: 'Choose a contiguous design run.' } as const;
}

export function decodeUploadedArtifact(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(CREATE_PROJECT_FILE_ERROR);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(CREATE_PROJECT_FILE_ERROR);
  }
}

/**
 * Remove a leading YAML frontmatter block from uploaded content. The artifact writer
 * (`writeArtifact` → `stampFrontmatter`) prepends fresh `version`/`updated_at`
 * frontmatter on every write, so the stored body must NOT already carry its own —
 * otherwise the file ends up with two frontmatter blocks. Uploads are validated to
 * REQUIRE frontmatter (proof they are standard artifacts), then stripped here before
 * writing so the writer owns the single canonical frontmatter.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
}

export function parseExplorationUpload(content: string) {
  const hasFrontmatter = /^---\n[\s\S]+?\n---\n/m.test(content);
  const hasBackground = /^## Background\s*$/m.test(content);
  return hasFrontmatter && hasBackground
    ? { ok: true, value: content } as const
    : { ok: false, message: CREATE_PROJECT_FILE_ERROR } as const;
}

function labelToKind(label: string): string | null {
  const match = SPEC_TEMPLATE_SEEDS.find((seed) => seed.label.toLowerCase() === label.trim().toLowerCase());
  return match?.kind ?? null;
}

export async function parseSpecUpload(db: Db, content: string): Promise<
  | { ok: true; value: UploadedSpecProof }
  | { ok: false; message: string }
> {
  const sections = parseSpecSections(content);
  if (sections.length === 0) return { ok: false, message: CREATE_PROJECT_FILE_ERROR };

  const headings = [...new Set(sections.map((section) => section.component).filter(Boolean))];
  const kinds = headings.map(labelToKind);
  if (kinds.some((kind) => !kind)) return { ok: false, message: CREATE_PROJECT_FILE_ERROR };

  // Whole-table read (no filter) — the project's team is the only template set at
  // create time; no `eq`/where clause is needed.
  const rows = await db
    .select({ id: teamSpecTemplate.id, kind: teamSpecTemplate.kind })
    .from(teamSpecTemplate);

  const byKind = new Map(rows.map((row) => [row.kind, row.id]));
  const selectedTemplateIds = kinds.map((kind) => byKind.get(kind!)).filter(Boolean) as string[];
  if (selectedTemplateIds.length !== kinds.length) {
    return { ok: false, message: CREATE_PROJECT_FILE_ERROR };
  }

  return {
    ok: true,
    value: {
      filePath: '',
      selectedTemplateIds,
      components: selectedTemplateIds.map((templateId) => ({
        id: randomUUID(),
        templateId,
        approvals: [] as string[],
      })),
    },
  };
}
