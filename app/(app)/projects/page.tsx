import { PageHeader, EmptyState } from '@/components/forge/PageHeader';

/** Projects placeholder (Spec 1). The real list lands in Spec 3. */
export default function ProjectsPage() {
  return (
    <>
      <PageHeader title="Projects" subtitle="Your team's projects." />
      <EmptyState title="No projects yet" hint="Projects arrive in a later release." />
    </>
  );
}
