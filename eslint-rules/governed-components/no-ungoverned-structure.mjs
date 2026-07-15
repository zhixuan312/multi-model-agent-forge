import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const allowlistPath = join(__dirname, '../../.mma/governance/component-governance-allowlist.json');
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));

const PATTERN = 'grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch';
const CANONICAL = 'src/components/patterns/stage-shell.tsx';
const ALLOWED = new Set([CANONICAL, ...allowlist]);

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
