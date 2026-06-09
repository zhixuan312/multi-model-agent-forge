import { StageStub } from '@/components/forge/StageStub';

/** Execute stage stub — locked Build stage (real content arrives in Spec 7). */
export default function ExecuteStubPage() {
  return <StageStub title="Execute" comingIn="Spec 7" locked />;
}
