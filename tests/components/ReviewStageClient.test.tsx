import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReviewStageClient, type ReviewPassView } from '@/components/forge/ReviewStageClient';

/** Never resolves — leaves the component in its applying state so the progress line is readable. */
const transition = vi.fn(() => new Promise<void>(() => {}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p1/review',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/useMmaDispatch', () => ({
  useMmaDispatch: () => ({ busyHandlers: new Set<string>(), dispatch: vi.fn(), transition }),
}));

const finding = (i: number) => ({
  weight: 'high',
  category: 'correctness',
  claim: `Finding ${i}`,
  evidence: 'evidence',
  file: 'src/a.ts',
  line: i,
  suggestion: 'fix it',
});

const pass: ReviewPassView = {
  passNo: 1,
  findings: [finding(1), finding(2), finding(3), finding(4)],
  appliedIndices: [],
};

function wrap() {
  return render(
    <TooltipProvider>
      <ReviewStageClient
        projectId="p1"
        projectName="Demo"
        passes={[pass]}
        reviewRunning={false}
        applyRunning={false}
      />
    </TooltipProvider>,
  );
}

// Block body on purpose: `mockClear()` RETURNS the mock, and a hook that returns a function
// hands vitest a teardown callback — it would invoke this never-resolving mock and hang.
beforeEach(() => { transition.mockClear(); });

describe('ReviewStageClient — applying a subset', () => {
  /**
   * The progress line read `pass.findings.length`, so applying 2 of 4 announced
   * "Applying 4 findings" — contradicting the selection the user just made and the apply
   * bar that dispatched it. Partial apply is the whole point of the checkboxes; the count
   * has to be what was sent.
   */
  it('names the number of findings actually dispatched, not the pass total', async () => {
    const user = userEvent.setup();
    wrap();

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThanOrEqual(4);
    await user.click(boxes[0]!);
    await user.click(boxes[1]!);

    await user.click(screen.getByRole('button', { name: /apply/i }));

    expect(transition).toHaveBeenCalledWith(
      'apply_review_findings',
      expect.objectContaining({ findingIndices: [0, 1], passNo: 1 }),
    );
    expect(await screen.findByText('Applying 2 findings...')).toBeInTheDocument();
    expect(screen.queryByText('Applying 4 findings...')).not.toBeInTheDocument();
  });

  it('singularises a one-finding apply', async () => {
    const user = userEvent.setup();
    wrap();

    await user.click(screen.getAllByRole('checkbox')[2]!);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    expect(await screen.findByText('Applying 1 finding...')).toBeInTheDocument();
  });
});
