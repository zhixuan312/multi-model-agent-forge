import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import rule from '../../eslint-rules/governed-components/no-ungoverned-structure.mjs';
import SIGNATURES from '../../eslint-rules/governed-components/signatures.json';

/**
 * This suite agreed with a dead rule.
 *
 * Both pinned `lg:items-stretch`, a utility `status-dashboard.tsx` had stopped emitting, so
 * the fixtures and the rule went on agreeing about a class string that appeared in NO file
 * in the repository. Every case passed; the rule could not fire on anything real. The
 * `valid` case was the worst of it — it exempted the canonical file for a string the
 * canonical file did not contain, and named `stage-shell.tsx`, which has never held the grid.
 *
 * Fixtures are now BUILT from `signatures.json`, the same file the rule reads, so a fixture
 * can no longer describe a layout that does not exist. `lint-rule-signature.test.ts` is the
 * other half: it checks the signature still matches the component it governs.
 */
const GRID = SIGNATURES.dashboardGrid;
const jsx = (name: string, extra = '') =>
  `export const ${name} = <div className="${GRID}${extra}" />;`;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe('no-ungoverned-structure rule', () => {
  tester.run('no-ungoverned-structure', rule as Rule.RuleModule, {
    valid: [
      {
        // The component that OWNS the grid is exempt — read from signatures.json, not
        // restated, because the rule's own exemption used to name the wrong file.
        filename: SIGNATURES.canonical,
        code: jsx('ok'),
      },
      {
        // A different three-column layout is not this one. Without a case like this the
        // rule could be widened to any grid and nothing would notice.
        filename: 'src/components/forge/SomeClient.tsx',
        code: 'export const ok = <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" />;',
      },
    ],
    invalid: [
      {
        // The allowlist is empty: every consumer converged onto StatusDashboard, so ANY
        // other file reintroducing the raw split is flagged.
        filename: 'src/components/forge/PlanStageClient.tsx',
        code: jsx('bad'),
        errors: [{ messageId: 'ungovernedStructure' }],
      },
      {
        // The trailing-utility case, which is what actually shipped: a file hand-rolling
        // the grid PLUS extra utilities. The old fixtures only ever tested the exact
        // historical string, so this shape had no coverage at all.
        filename: 'src/components/forge/NewStageClient.tsx',
        code: jsx('bad', ' lg:items-stretch'),
        errors: [{ messageId: 'ungovernedStructure' }],
      },
    ],
  });
});
