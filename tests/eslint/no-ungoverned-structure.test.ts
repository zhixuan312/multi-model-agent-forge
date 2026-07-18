import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import rule from '../../eslint-rules/governed-components/no-ungoverned-structure.mjs';

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
        // The canonical seam (stage-shell) is always exempt via the rule's CANONICAL const.
        filename: 'src/components/patterns/stage-shell.tsx',
        code: 'export const ok = <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch" />;',
      },
    ],
    invalid: [
      {
        // Allowlist is now empty — every consumer converged onto StatusDashboard, so ANY
        // file (previously-allowlisted or brand new) that reintroduces the raw split is flagged.
        filename: 'src/components/forge/PlanStageClient.tsx',
        code: 'export const bad = <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch" />;',
        errors: [{ messageId: 'ungovernedStructure' }],
      },
      {
        filename: 'src/components/forge/NewStageClient.tsx',
        code: 'export const bad = <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch" />;',
        errors: [{ messageId: 'ungovernedStructure' }],
      },
    ],
  });
});
