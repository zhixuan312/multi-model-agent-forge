/**
 * Governance conformance CLI — `pnpm governance:check`.
 *
 * Scans app/ + src/ and reports, per governed layer, every page/component that bypasses
 * the canonical component. Exits 1 when any layer has violations so CI (or a pre-push
 * hook) fails on a regression; exits 0 when the whole app conforms.
 *
 *   pnpm governance:check            # human-readable report
 *   pnpm governance:check --json     # machine-readable, for tooling
 */
import { summarizeConformance } from '@/governance/conformance';
import { collectSourceFiles } from '@/governance/conformance-scan';

const json = process.argv.includes('--json');
const root = process.cwd();

const files = collectSourceFiles(root);
const summary = summarizeConformance(files);
const total = summary.reduce((n, layer) => n + layer.violations.length, 0);

if (json) {
  console.log(JSON.stringify({ scanned: files.length, total, layers: summary }, null, 2));
} else {
  console.log(`\nGovernance conformance — scanned ${files.length} source files\n`);
  for (const layer of summary) {
    const ok = layer.violations.length === 0;
    console.log(`${ok ? '✓' : '✗'} ${layer.label}  (${layer.checked} checked)`);
    console.log(`    ${layer.convention}`);
    for (const v of layer.violations) {
      console.log(`    → ${v.file}\n      ${v.reason}`);
    }
    console.log('');
  }
  console.log(
    total === 0
      ? 'All governed layers conform.\n'
      : `${total} violation${total === 1 ? '' : 's'} across ${summary.filter((l) => l.violations.length).length} layer(s).\n`,
  );
}

process.exit(total === 0 ? 0 : 1);
