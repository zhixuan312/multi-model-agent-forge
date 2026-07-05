import { resolveNextActionFromDetails } from '@/automation/details-resolver';
import { buildInitialDetails, type Details } from '@/details/schema';
import { AUDIT_PASS_CAP } from '@/automation/audit-loop-policy';

const revisedFixed = (passNo: number) => ({
  passNo, status: 'revised',
  audit: { attempts: [{ status: 'done', at: 'x' }] },
  fix: { attempts: [{ status: 'done', at: 'x' }] },
});
const revisedUnfixed = (passNo: number) => ({
  passNo, status: 'revised',
  audit: { attempts: [{ status: 'done', at: 'x' }] },
});

function reviewActive(passes: unknown[]): Details {
  const d = buildInitialDetails();
  for (const s of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[s].status = 'done';
  d.stages.review.status = 'active';
  d.stages.review.phases.review.status = 'active';
  d.stages.review.phases.review.repos = [
    { repoId: 'r1', reviewPasses: passes },
  ] as unknown as typeof d.stages.review.phases.review.repos;
  return d;
}

describe('resolver audit-loops via shared auditLoopStep', () => {
  it('review at the 5-pass CAP with the last pass revised+UNFIXED → apply_review_findings (line-191 fix)', () => {
    const passes = [
      ...Array.from({ length: AUDIT_PASS_CAP - 1 }, (_, i) => revisedFixed(i + 1)),
      revisedUnfixed(AUDIT_PASS_CAP),
    ];
    const action = resolveNextActionFromDetails(reviewActive(passes));
    expect(action.kind).toBe('apply_review_findings');
    expect(action.data?.repoId).toBe('r1');
  });

  it('review at the CAP with the last pass fixed → advance to journal', () => {
    const passes = Array.from({ length: AUDIT_PASS_CAP }, (_, i) => revisedFixed(i + 1));
    const action = resolveNextActionFromDetails(reviewActive(passes));
    expect(action.kind).toBe('advance_stage');
    expect(action.stage).toBe('journal');
  });

  it('review clean → advance to journal', () => {
    const passes = [{ passNo: 1, status: 'clean', review: { attempts: [{ status: 'done', at: 'x' }] } }];
    const action = resolveNextActionFromDetails(reviewActive(passes));
    expect(action.kind).toBe('advance_stage');
  });
});
