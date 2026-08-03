import type { StageKind } from '@/db/enums';

/**
 * The design stages a project can be scoped to — the one list, and the one name.
 *
 * It was written out five times: twice in `details/schema.ts`, twice in `projects-core.ts`,
 * once in `NewProjectForm`, which also aliased the type to a SECOND name (`DesignStage`)
 * over `create-project-subset`'s `DesignStageSelection`. Two names and five literals for
 * three strings.
 *
 * ## Why its own module
 *
 * The obvious home was `create-project-subset.ts`, next to `validateSubsetSelection`. That
 * module imports `node:crypto`, and `NewProjectForm` is a `'use client'` component — so a
 * VALUE import of the list from there puts a Node builtin in the browser bundle and fails
 * `next build`. `tests/distribution/client-server-boundary.test.ts` caught it on the first
 * run, which is precisely the bug it was written for (`ModelsPanel` importing `TIERS` from
 * the fs-reading config reader). `src/mma/tiers.ts` exists for the same reason.
 *
 * The other obvious home was `db/enums.ts`, where fixed value sets live and where the
 * single-source ratchet can see them. Also wrong: `export/types.ts`'s `ExportKind` is the
 * same three strings for a different reason — the three deliverable ARTIFACTS — and
 * `tests/distribution/single-source-maps.test.ts` says in as many words that those are a
 * different relationship, not a copy of this one. Putting it there would flag four export
 * modules as duplicating a set they have no reason to track.
 *
 * `satisfies readonly StageKind[]` keeps it from drifting out of the stage enum.
 */
export const DESIGN_STAGES = ['exploration', 'spec', 'plan'] as const satisfies readonly StageKind[];

export type DesignStage = (typeof DESIGN_STAGES)[number];
