/**
 * Mock re-export shim. The canonical Plan-stage view types live in
 * `@/build/plan-types`; this module is kept only so the mock data layer
 * (`plan.ts`) and its tests can resolve them under the mock path.
 */
export type { PlanPhaseSeed, PlanTaskSeed, PlanAuditFinding } from '@/build/plan-types';
