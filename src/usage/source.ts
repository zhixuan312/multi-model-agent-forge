/**
 * Where agent work came from — one definition for the query core, the tabs, the activity
 * filter and the row labels.
 *
 * The union was written out four times (`usage-core` twice, `UsageBatchTable`'s
 * `SourceFilter`, `UsageTabsNav`'s `UsageView`), and the two label sets lived inline: the
 * filter's short names in a `<SelectItem>` list and the row's long names in a nested
 * ternary. Adding a source meant finding all six.
 *
 * DB-free so the client tables and nav can import it.
 */
export const USAGE_SOURCES = ['projects', 'loops', 'standalone'] as const;

export type UsageSource = (typeof USAGE_SOURCES)[number];

/** Short name, for the activity filter. */
export const SOURCE_FILTER_LABEL: Record<UsageSource, string> = {
  projects: 'Projects',
  loops: 'Loops',
  standalone: 'Standalone',
};

/** Long name with its qualifier, for an activity row. */
export const SOURCE_ROW_LABEL: Record<UsageSource, string> = {
  projects: 'Projects (SDLC)',
  loops: 'Loops (scheduled)',
  standalone: 'Standalone (ad-hoc)',
};
