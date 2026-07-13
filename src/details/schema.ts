import { z } from 'zod';

const stageStatus = z.enum(['pending', 'active', 'done']);
const phaseStatus = z.enum(['pending', 'active', 'done']);
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
