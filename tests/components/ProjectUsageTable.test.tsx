// @vitest-environment jsdom
/**
 * The phase filter listed three of `PROJECT_PHASE`'s four members, omitting `completed`.
 *
 * `usageByProject` applies no phase filter, so a completed project DOES appear in this
 * table and renders a `completed` badge — but the dropdown offered design · build · learn,
 * so every option except "All phases" hid it, and none showed it. A phase visible in a
 * column and unreachable from the control beside it.
 *
 * `completed` has now been the forgotten member three times (the Active metric on the
 * projects dashboard was the first), which is why the options derive from the enum rather
 * than being corrected in place.
 */
import { render, screen, within } from '@testing-library/react';
import { PROJECT_PHASE } from '@/db/enums';
import { ProjectUsageTable } from '../../app/(app)/usage/ProjectUsageTable';

const row = (projectId: string, projectName: string, phase: string) => ({
  projectId,
  projectName,
  phase,
  taskCount: 3,
  costUsd: 1.5,
  savedUsd: 0.5,
  tokens: 1000,
  durationMs: 60_000,
});

function renderTable() {
  return render(
    <ProjectUsageTable
      data={PROJECT_PHASE.map((p, i) => row(`p${i}`, `Project ${p}`, p))}
      detailByProject={{}}
    />,
  );
}

describe('ProjectUsageTable — phase filter', () => {
  it('offers every phase a row can carry', async () => {
    renderTable();
    // Radix renders options on open; the trigger is the accessible entry point.
    const trigger = screen.getByRole('combobox', { name: /filter by phase/i });
    trigger.click();

    const listbox = await screen.findByRole('listbox');
    const optionNames = within(listbox)
      .getAllByRole('option')
      .map((o) => (o.textContent ?? '').trim().toLowerCase());

    for (const phase of PROJECT_PHASE) {
      expect(optionNames, `"${phase}" is a phase a row can show — it must be filterable`)
        .toContain(phase);
    }
    // plus the "all" escape hatch
    expect(optionNames).toContain('all phases');
  });

  it('shows a completed project in the unfiltered table', () => {
    renderTable();
    expect(screen.getByText('Project completed')).toBeInTheDocument();
  });
});
