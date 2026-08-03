/**
 * Forge design-system barrel. Screens import primitives from `@/components/ui`:
 *   import { Button, Card, Field, Input, Badge } from '@/components/ui';
 *
 * Two modules are deliberately NOT re-exported here, and are imported by path:
 *   - `./toast`     — a module-level store plus the `Toaster` mount, not a primitive
 *                     you compose into a screen (`@/components/ui/toast`).
 *   - `./nav-tabs`  — the page sub-nav, whose five callers are themselves components
 *                     rather than screens (`@/components/ui/nav-tabs`).
 * Keep it that way: adding them would give each two valid import paths.
 */

// Foundation
export * from './typography';
export * from './button';
export * from './card';

// Forms
export * from './field';
export * from './field-styles';
export * from './input';
export * from './textarea';
export * from './select';
export * from './segmented';
export * from './checkbox';
export * from './switch';

// Display & status
export * from './table';
export * from './data-table';
export * from './badge';
export * from './icon-button';
export * from './banner';
export * from './empty-state';
export * from './avatar';
export * from './avatar-group';
export * from './metric-card';
export * from './next-action-pill';
export * from './stage-rail';
export * from './spinner';
export * from './separator';
export * from './tooltip';

// Overlays & navigation
export * from './dropdown-menu';
export * from './breadcrumb';

// Layout
export * from './section';
export * from './grid';
export * from './split';
export * from './field-grid';
export * from './avatar-picker';
export * from './search-input';
export * from './tab-bar';
export * from './toolbar';
export * from './shell';
