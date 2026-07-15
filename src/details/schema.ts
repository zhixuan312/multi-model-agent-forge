import { z } from 'zod';

const stageStatus = z.enum(['pending', 'active', 'done', 'skipped']);
// `skipped` phases exist for subset runs: a phase that was never performed (an
// intermediate phase of a stage satisfied by an uploaded artifact, or any phase of a
// skipped stage). It is distinct from `done` (the phase produced output) — the stepper
// renders it struck-through and non-navigable.
const phaseStatus = z.enum(['pending', 'active', 'done', 'skipped']);
const attemptStatus = z.enum(['running', 'done', 'failed']);
const discoverTaskStatus = z.enum(['draft', 'running', 'recorded', 'failed']);
const planTaskStatus = z.enum(['pending', 'approved', 'queued', 'executing', 'verifying', 'fixing', 'committed', 'skipped', 'failed']);
const learningStatus = z.enum(['proposed', 'kept', 'removed', 'recorded']);
const auditPassStatus = z.enum(['revised', 'clean']);
const automationStatus = z.enum(['off', 'running']);

const attemptSchema = z.object({
  batchId: z.string(),
  status: attemptStatus,
  at: z.string(),
  contextBlockId: z.string().nullable().optional(), // read-route terminal block; null on write/fix attempts, absent on legacy rows
});

const auditPassSchema = z.object({
  passNo: z.number(),
  status: auditPassStatus,
  appliedIndexes: z.array(z.number()).optional(),
  audit: z.object({ attempts: z.array(attemptSchema) }).optional(),
  fix: z.object({ attempts: z.array(attemptSchema) }).optional(),
});

const reviewPassSchema = z.object({
  passNo: z.number(),
  status: auditPassStatus,
  appliedIndexes: z.array(z.number()).optional(),
  review: z.object({ attempts: z.array(attemptSchema) }).optional(),
  fix: z.object({ attempts: z.array(attemptSchema) }).optional(),
});

const repoSchema = z.object({
  id: z.string(),
  name: z.string(),
  pathOnDisk: z.string(),
  defaultBranch: z.string(),
});

const automationSchema = z.object({
  status: automationStatus,
  startedAt: z.string().optional(),
  stoppedAt: z.string().optional(),
  /** Single-driver lease (G1): the driver that currently owns this project's auto
   * loop + when it last heartbeat. A second driver (boot-resume / dev-restart) only
   * takes over when the heartbeat is stale — guaranteeing ONE driver per project so
   * the pipeline stays strictly sequential. Absent when no driver holds the lease. */
  driverId: z.string().optional(),
  driverHeartbeatAt: z.string().optional(),
});

const discoverTaskSchema = z.object({
  kind: z.enum(['investigate', 'research', 'journal']),
  title: z.string().optional(),
  prompt: z.string(),
  status: discoverTaskStatus,
  repoId: z.string().optional(),
  attempts: z.array(attemptSchema).default([]),
});

const componentSchema = z.object({
  id: z.string().optional().default(''),
  templateId: z.string(),
  approvals: z.array(z.string()).default([]),
}).transform((c) => ({
  ...c,
  id: c.id || c.templateId,
}));

const planTaskMetaSchema = z.object({
  buildCmd: z.string().nullable().optional(),
  testCmd: z.string().nullable().optional(),
  fixCommitSha: z.string().optional(),
}).optional();

const planTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: planTaskStatus,
  approvals: z.array(z.string()).default([]),
  attempts: z.array(attemptSchema).default([]),
  targetRepoId: z.string().optional(),
  orderIndex: z.number().optional(),
  dependsOn: z.array(z.string()).optional(),
  reviewPolicy: z.enum(['reviewed', 'none']).default('reviewed'),
  phase: z.string().optional(),
  branch: z.string().optional(),
  targetBranch: z.string().optional(),
  commitSha: z.string().optional(),
  fixNote: z.string().optional(),
  mmaBatchId: z.string().optional(),
  meta: planTaskMetaSchema,
});

const learningSchema = z.object({
  heading: z.string(),
  type: z.enum(['decision', 'insight']),
  status: learningStatus,
});

const configureRepoSchema = z.object({
  repoId: z.string(),
  branch: z.string(),
  targetBranch: z.string(),
  taskIds: z.array(z.string()).default([]),
});

const implementRepoSchema = z.object({
  repoId: z.string(),
  attempts: z.array(attemptSchema).default([]),
});

const reviewRepoSchema = z.object({
  repoId: z.string(),
  reviewPasses: z.array(reviewPassSchema).default([]),
});

const explorationSchema = z.object({
  status: stageStatus,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  phases: z.object({
    brief: z.object({
      status: phaseStatus,
      text: z.string().optional(),
    }),
    discover: z.object({
      status: phaseStatus,
      attempts: z.array(attemptSchema).default([]),
      tasks: z.array(discoverTaskSchema).default([]),
    }),
    synthesize: z.object({
      status: phaseStatus,
      file: z.string().nullable().optional(),
      attempts: z.array(attemptSchema).default([]),
    }),
  }),
});

const specSchema = z.object({
  status: stageStatus,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  participants: z.array(z.string()).default([]),
  phases: z.object({
    outline: z.object({
      status: phaseStatus,
      selectedTemplateIds: z.array(z.string()).default([]),
    }),
    craft: z.object({
      status: phaseStatus,
      file: z.string().nullable().optional(),
      components: z.array(componentSchema).default([]),
      attempts: z.array(attemptSchema).default([]),
    }),
    finalize: z.object({
      status: phaseStatus,
      auditPasses: z.array(auditPassSchema).default([]),
      /** Spec-level sign-off at Finalize — approving the WHOLE spec (distinct
       * from the per-component approvals done in Craft). Member IDs who approved. */
      approvals: z.array(z.string()).default([]),
    }),
  }),
});

const planSchema = z.object({
  status: stageStatus,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  participants: z.array(z.string()).default([]),
  phases: z.object({
    refine: z.object({
      status: phaseStatus,
      file: z.string().nullable().optional(),
      tasks: z.array(planTaskSchema).default([]),
      attempts: z.array(attemptSchema).default([]),
    }),
    validate: z.object({
      status: phaseStatus,
      auditPasses: z.array(auditPassSchema).default([]),
    }),
  }),
});

const executeSchema = z.object({
  status: stageStatus,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  phases: z.object({
    configure: z.object({
      status: phaseStatus,
      repos: z.array(configureRepoSchema).default([]),
    }),
    implement: z.object({
      status: phaseStatus,
      repos: z.array(implementRepoSchema).default([]),
    }),
  }),
});

const reviewStageSchema = z.object({
  status: stageStatus,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  phases: z.object({
    review: z.object({
      status: phaseStatus,
      repos: z.array(reviewRepoSchema).default([]),
    }),
  }),
});

const journalSchema = z.object({
  status: stageStatus,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  participants: z.array(z.string()).default([]),
  phases: z.object({
    journal: z.object({
      status: phaseStatus,
      file: z.string().nullable().optional(),
      attempts: z.array(attemptSchema).default([]),
      learnings: z.array(learningSchema).default([]),
    }),
    summary: z.object({
      status: phaseStatus,
      attempts: z.array(attemptSchema).default([]),
    }),
  }),
});

const detailsSchema = z.object({
  automation: automationSchema,
  repos: z.array(repoSchema).default([]),
  stages: z.object({
    exploration: explorationSchema,
    spec: specSchema,
    plan: planSchema,
    execute: executeSchema,
    review: reviewStageSchema,
    journal: journalSchema,
  }),
});

export type Details = z.infer<typeof detailsSchema>;
export type Attempt = z.infer<typeof attemptSchema>;

export function validateDetails(json: unknown): Details {
  return detailsSchema.parse(json);
}

export function buildInitialDetails(): Details {
  return {
    automation: { status: 'off' },
    repos: [],
    stages: {
      exploration: {
        status: 'active',
        phases: {
          brief: { status: 'active' },
          discover: { status: 'pending', attempts: [], tasks: [] },
          synthesize: { status: 'pending', attempts: [] },
        },
      },
      spec: {
        status: 'pending',
        participants: [],
        phases: {
          outline: { status: 'pending', selectedTemplateIds: [] },
          craft: { status: 'pending', components: [], attempts: [] },
          finalize: { status: 'pending', auditPasses: [], approvals: [] },
        },
      },
      plan: {
        status: 'pending',
        participants: [],
        phases: {
          refine: { status: 'pending', tasks: [], attempts: [] },
          validate: { status: 'pending', auditPasses: [] },
        },
      },
      execute: {
        status: 'pending',
        phases: {
          configure: { status: 'pending', repos: [] },
          implement: { status: 'pending', repos: [] },
        },
      },
      review: {
        status: 'pending',
        phases: {
          review: { status: 'pending', repos: [] },
        },
      },
      journal: {
        status: 'pending',
        participants: [],
        phases: {
          journal: { status: 'pending', attempts: [], learnings: [] },
          summary: { status: 'pending', attempts: [] },
        },
      },
    },
  };
}

export interface UploadedSpecProof {
  filePath: string;
  selectedTemplateIds: string[];
  components: Array<{ id: string; templateId: string; approvals: string[] }>;
}

export interface BuildSubsetDetailsArgs {
  selectedDesignStages: Array<'exploration' | 'spec' | 'plan'>;
  uploadedExplorationFile?: string;
  uploadedSpec?: UploadedSpecProof;
  forgeApprovalMemberId?: string;
}

export function buildSubsetDetails(args: BuildSubsetDetailsArgs): Details {
  // Clone the base initial details
  const d = buildInitialDetails();
  const selected = new Set(args.selectedDesignStages);
  const entry = args.selectedDesignStages[0] ?? 'exploration';

  // Design stages: active (the entry) / pending (in-scope, later) / skipped (out of scope).
  for (const stage of ['exploration', 'spec', 'plan'] as const) {
    d.stages[stage].status = selected.has(stage)
      ? (stage === entry ? 'active' : 'pending')
      : 'skipped';
  }

  // Phase statuses must follow the stage so the stepper tells the truth:
  //  - a SKIPPED stage skips ALL its phases (nothing ran, nothing is navigable);
  //  - a PENDING in-scope stage leaves its phases pending;
  //  - the ACTIVE entry stage keeps the initial layout (its first phase active).
  if (d.stages.exploration.status === 'skipped') {
    d.stages.exploration.phases.brief.status = 'skipped';
    d.stages.exploration.phases.discover.status = 'skipped';
    d.stages.exploration.phases.synthesize.status = 'skipped';
  } else if (d.stages.exploration.status === 'pending') {
    d.stages.exploration.phases.brief.status = 'pending';
  }
  if (d.stages.spec.status === 'skipped') {
    d.stages.spec.phases.outline.status = 'skipped';
    d.stages.spec.phases.craft.status = 'skipped';
    d.stages.spec.phases.finalize.status = 'skipped';
  } else if (d.stages.spec.status === 'pending') {
    d.stages.spec.phases.outline.status = 'pending';
  }
  if (d.stages.plan.status === 'skipped') {
    d.stages.plan.phases.refine.status = 'skipped';
    d.stages.plan.phases.validate.status = 'skipped';
  } else if (d.stages.plan.status === 'pending') {
    d.stages.plan.phases.refine.status = 'pending';
  }

  // Build (execute + review) is never part of a subset — skip the stages AND their phases.
  d.stages.execute.status = 'skipped';
  d.stages.execute.phases.configure.status = 'skipped';
  d.stages.execute.phases.implement.status = 'skipped';
  d.stages.review.status = 'skipped';
  d.stages.review.phases.review.status = 'skipped';
  // Journal (Reflect) is the universal terminal — always kept pending.
  d.stages.journal.status = 'pending';

  // A BYO upstream artifact SATISFIES its stage: the stage becomes done and the phase
  // that stores the artifact is done, but the interactive/agentic phases that never
  // actually ran are marked skipped (not done). "We only keep the very last phase; the
  // first two are skipped." Skipped phases are non-navigable in the stepper.
  if (args.uploadedExplorationFile) {
    d.stages.exploration.status = 'done';
    d.stages.exploration.phases.brief.status = 'skipped';
    d.stages.exploration.phases.discover.status = 'skipped';
    d.stages.exploration.phases.synthesize.status = 'done';
    d.stages.exploration.phases.synthesize.file = args.uploadedExplorationFile;
  }

  // Uploaded spec: the spec file lives in the `craft` phase, so that is the done
  // (artifact) phase; the outline (template pick) and finalize (audit/approval) phases
  // were not interactively performed → skipped. Their derived data (templates, the
  // auto-approval) is still recorded on the skipped phases for downstream reads.
  if (args.uploadedSpec) {
    d.stages.spec.status = 'done';
    d.stages.spec.phases.outline.status = 'skipped';
    d.stages.spec.phases.outline.selectedTemplateIds = args.uploadedSpec.selectedTemplateIds;
    d.stages.spec.phases.craft.status = 'done';
    d.stages.spec.phases.craft.file = args.uploadedSpec.filePath;
    d.stages.spec.phases.craft.components = args.uploadedSpec.components;
    d.stages.spec.phases.finalize.status = 'skipped';
    d.stages.spec.phases.finalize.approvals = args.forgeApprovalMemberId ? [args.forgeApprovalMemberId] : [];
  }

  return d;
}
