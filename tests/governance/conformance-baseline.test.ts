import { collectSourceFiles } from '@/governance/conformance-scan';
import { summarizeConformance, checkConformance } from '@/governance/conformance';

/**
 * The conformance RATCHET. Runs the real rules over the real repo. Today every governed
 * structural layer is fully converged, so the expected violation set is EMPTY. If someone
 * adds a page that hand-rolls its frame, a raw dashboard grid, or a bare <StageStepper>,
 * this fails — pointing them at the governed seam. Update the expectation only when a
 * violation is intentionally, and temporarily, accepted.
 */
describe('conformance baseline (whole repo)', () => {
  const files = collectSourceFiles(process.cwd());

  it('actually scanned the repository', () => {
    // Sanity: the scan found real source (not an empty read that would hide violations).
    expect(files.length).toBeGreaterThan(100);
  });

  it('has ZERO structural conformance violations', () => {
    const violations = checkConformance(files);
    // Print offenders on failure so the message is actionable.
    expect(violations).toEqual([]);
  });

  it('checked a non-trivial number of files in each structural layer', () => {
    const summary = summarizeConformance(files);
    for (const layer of summary) {
      expect(layer.checked, `${layer.label} scanned no files`).toBeGreaterThan(0);
    }
    // App shell scopes only authed pages; there are well over a dozen.
    const appShell = summary.find((s) => s.slotId === 'appShell')!;
    expect(appShell.checked).toBeGreaterThanOrEqual(15);
  });
});
