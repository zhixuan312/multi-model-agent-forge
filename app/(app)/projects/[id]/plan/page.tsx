import { StageStub } from '@/components/forge/StageStub';

/** Plan stage stub — locked Build stage (real content arrives in Spec 7). */
export default function PlanStubPage() {
  return <StageStub title="Plan" comingIn="Spec 7" locked />;
}
