import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const allowlist = JSON.parse(readFileSync(join(__dirname, 'allowlist.json'), 'utf8'));

/**
 * The signature comes from `signatures.json`, shared with `src/governance/conformance.ts`.
 *
 * Both used to hold their own copy. `conformance.ts` was corrected when its copy turned out
 * to include `lg:items-stretch`, a utility `status-dashboard.tsx` no longer emits — this
 * rule was not, so it matched a string present in NO file in the repo, reported a
 * permanently clean layer, and would have let a page hand-rolling the CURRENT grid through.
 * The `CANONICAL` file it exempted was wrong too: it named `stage-shell.tsx`, which does not
 * contain the grid at all.
 */
const signatures = JSON.parse(readFileSync(join(__dirname, 'signatures.json'), 'utf8'));
const PATTERN = signatures.dashboardGrid;
const ALLOWED = new Set([signatures.canonical, ...allowlist]);

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'warn-baseline protection for new raw stage-layout duplication',
    },
    schema: [],
    messages: {
      ungovernedStructure: 'Use the governed stage-layout seam instead of duplicating the raw grid structure.',
    },
  },
  create(context) {
    const filename = context.getFilename().replace(process.cwd() + '/', '');
    if (ALLOWED.has(filename)) return {};

    return {
      JSXAttribute(node) {
        if (node.name?.name !== 'className') return;
        const value = node.value?.type === 'Literal' ? node.value.value : null;
        if (typeof value !== 'string') return;
        if (!value.includes(PATTERN)) return;
        context.report({ node, messageId: 'ungovernedStructure' });
      },
    };
  },
};

export default rule;
