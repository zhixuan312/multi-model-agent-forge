import { PageHeader, EmptyState } from '@/components/forge/PageHeader';

/** Journal placeholder (Spec 1). The real journal viewer lands in Spec 6. */
export default function JournalPage() {
  return (
    <>
      <PageHeader title="Journal" subtitle="The team knowledge base." />
      <EmptyState title="No journal entries yet" hint="The journal viewer arrives in a later release." />
    </>
  );
}
