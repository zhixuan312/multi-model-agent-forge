import { StageStub } from '@/components/forge/StageStub';

/** Review stage stub — locked Build stage (real content arrives in Spec 7). */
export default function ReviewStubPage() {
  return <StageStub title="Review" comingIn="Spec 7" locked />;
}
