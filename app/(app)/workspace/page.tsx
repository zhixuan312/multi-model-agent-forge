import { PageHeader, EmptyState } from '@/components/forge/PageHeader';

/** Workspace placeholder (Spec 1). The real workspace lands in Spec 2. */
export default function WorkspacePage() {
  return (
    <>
      <PageHeader title="Workspace" subtitle="The team's shared workspace." />
      <EmptyState title="No workspace yet" hint="Workspace setup arrives in a later release." />
    </>
  );
}
