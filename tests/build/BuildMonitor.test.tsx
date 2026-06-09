import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { BuildMonitor } from '@/components/forge/BuildMonitor';
import type { BuildView } from '@/build/build-core';
import type { ProjectEvent } from '@/sse/event-bus';

/** A controllable EventSource fake so we can push SSE messages from the test. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  close(): void {}
  emit(event: ProjectEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

const VIEW: BuildView = {
  planMd: '# Plan\n\n## Task 1: Cache\n\ncache it',
  planVersion: 1,
  tasks: [
    { id: 't1', title: 'Task 1: Cache', detail: null, repoName: 'svc', status: 'queued', reviewPolicy: 'full', branch: null, commitSha: null, fixNote: null, dependsOn: [], buildCmd: null, testCmd: null },
  ],
  writeTargets: ['svc'],
  readOnly: ['metrics'],
  auditPasses: [{ passNo: 1, findingsCount: 0, verdict: 'clean' }],
};

describe('BuildMonitor', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.last = null;
  });

  it('renders write/read split, audit ledger, and the plan', () => {
    render(<BuildMonitor projectId="p1" initial={VIEW} />);
    expect(screen.getAllByText(/svc/).length).toBeGreaterThan(0);
    expect(screen.getByText(/metrics/)).toBeInTheDocument();
    expect(screen.getByText(/pass 1/)).toBeInTheDocument();
  });

  it('status is conveyed by a text label + icon (not color alone)', () => {
    render(<BuildMonitor projectId="p1" initial={VIEW} />);
    // queued task shows the textual label.
    expect(screen.getByText(/queued/)).toBeInTheDocument();
  });

  it('patches the current task on task.executing → task.committed; surfaces inline fix; highlights current (aria-current)', () => {
    render(<BuildMonitor projectId="p1" initial={VIEW} />);
    const es = FakeEventSource.last!;
    act(() => es.emit({ type: 'task.executing', taskId: 't1', repo: 'svc', branch: 'forge/p1/svc', title: 'Task 1: Cache' }));
    expect(screen.getByText(/executing/)).toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')).not.toBeNull();
    act(() => es.emit({ type: 'task.fixing', taskId: 't1', note: 'fixed the import' }));
    expect(screen.getByText(/inline fix: fixed the import/)).toBeInTheDocument();
    act(() => es.emit({ type: 'task.committed', taskId: 't1', commitSha: 'ABCDEF1234' }));
    expect(screen.getByText(/committed/)).toBeInTheDocument();
    expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument();
  });

  it('aggregates cost.tick into the spend chip (observability only)', () => {
    render(<BuildMonitor projectId="p1" initial={VIEW} />);
    const es = FakeEventSource.last!;
    act(() => es.emit({ type: 'cost.tick', runCostUsd: 0.5, byRoute: { audit: 0.1, executePlan: 0.4, review: 0 } }));
    expect(screen.getByText(/\$0\.5000/)).toBeInTheDocument();
  });

  it('renders the review verdict on review.done', () => {
    render(<BuildMonitor projectId="p1" initial={VIEW} />);
    const es = FakeEventSource.last!;
    act(() => es.emit({ type: 'review.done', repo: 'svc', verdict: 'changes_required', findingsCount: 2 }));
    expect(screen.getByText(/changes required/)).toBeInTheDocument();
  });

  it('surfaces the "member executing repo" notice in an ARIA live region', () => {
    render(<BuildMonitor projectId="p1" initial={VIEW} />);
    const es = FakeEventSource.last!;
    act(() => es.emit({ type: 'execute.notice', memberId: 'm1', repo: 'svc' }));
    const notice = screen.getByText(/teammate is executing svc/);
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });
});
