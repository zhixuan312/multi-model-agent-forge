/**
 * The routes that make up each settings section.
 *
 * Settings tabs are SIBLING routes (/settings/team and /settings/members), not nested ones,
 * so the sidebar cannot decide what is selected from an href prefix alone — it needs the
 * section's full route list. Both the tab bars and the sidebar read these, so adding a tab
 * keeps the nav highlight correct instead of silently leaving it blank.
 *
 * Plain data on purpose: the sidebar is a client component, and importing the tab components
 * (which hold JSX icons) just to read their hrefs pulls those modules into its bundle.
 */
export const TEAM_SETTINGS_ROUTES = {
  team: '/settings/team',
  members: '/settings/members',
} as const;

export const ORG_SETTINGS_ROUTES = {
  teams: '/settings/org',
  connections: '/settings/connections',
  models: '/settings/models',
} as const;

export const TEAM_SETTINGS_HREFS: readonly string[] = Object.values(TEAM_SETTINGS_ROUTES);
export const ORG_SETTINGS_HREFS: readonly string[] = Object.values(ORG_SETTINGS_ROUTES);
