/**
 * Generate a large, realistic journal mock for stress-testing the Journal UI.
 *
 *   node scripts/gen-journal-mock.mjs [nodeCount=230] [logCount=300]
 *
 * Writes src/mock/seed/journal-nodes.json + journal-log.json. Deterministic
 * (seeded RNG) so re-runs are stable. ~200 of the nodes stay `adopted` ("active
 * knowledge"); the rest are superseded / dropped / inconclusive. Node bodies are
 * multi-paragraph engineering narratives (failure mode → impact → fix → lesson →
 * evidence; then durable rules) modelled on the REAL journal at
 * multi-model-agent/.mmagent/journal so the length + texture are representative.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dir, '..', 'src', 'mock', 'seed');

const NODE_COUNT = Number(process.argv[2] ?? 230);
const LOG_COUNT = Number(process.argv[3] ?? 300);

// ---- deterministic RNG ----------------------------------------------------
let _s = 0x2f6e2b1;
const rnd = () => {
  _s = (_s * 1103515245 + 12345) & 0x7fffffff;
  return _s / 0x7fffffff;
};
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const sample = (arr, n) => {
  const c = [...arr];
  const out = [];
  for (let i = 0; i < n && c.length; i++) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
  return out;
};
const pad = (n) => String(n).padStart(4, '0');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

// ---- vocab ----------------------------------------------------------------
const areas = [
  'completion gating', 'cost accounting', 'the lifecycle driver', 'reviewer selection',
  'telemetry attribution', 'the journal graph store', 'same-repo write dispatch', 'path confinement',
  'the structured-output contract', 'the research orchestrator', 'provider token accounting',
  'the smoke harness', 'config loading', 'the transport layer', 'event correlation', 'provider identity',
  'worktree isolation', 'the unified task API', 'skill resolution', 'the install writers',
  'the settings UI', 'the journal viewer', 'the recall endpoint', 'the graph view',
  'mock-backend wiring', 'the bounded-execution guard', 'the idle guard', 'enum narrowing',
  'the commit stage', 'the rework loop',
];
const techs = [
  'a single pure function', 'a discriminated union', 'Zod validation at the boundary', 'Radix primitives',
  'a TanStack-backed table', 'Cytoscape + fcose', 'a file-backed store', 'an in-memory cache keyed by id',
  'tier inversion', 'objective lifecycle evidence', 'a clean-room published-artifact check', 'jsdom hydration',
  'the live full-pipeline smoke', 'a server-side proxy', 'ESM-only imports with .js specifiers',
  'node:child_process process groups', 'incremental usage accumulation', 'a one-owner serialization lock',
];
const tagPool = [
  'completion-gating', 'lifecycle', 'telemetry', 'worker-self-assessment', 'objective-signals',
  'read-routes', 'criteria', 'smoke-testing', 'end-to-end', 'cost-accounting', 'pricing', 'tiers',
  'code-review', 'reviewer-separation', 'cross-tier', 'quality', 'dispatch', 'cancellation', 'worktrees',
  'sandbox', 'confinement', 'path-traversal', 'schema-version', 'structured-output', 'parser-drops',
  'ui', 'design-system', 'radix', 'hydration', 'testing', 'settings', 'ux', 'information-architecture',
  'mock', 'architecture', 'layout', 'perf', 'security', 'migration', 'providers', 'recall', 'graph',
  'config', 'dx', 'a11y', 'transport', 'events', 'identity', 'review', 'commit', 'enum-narrowing',
];
const linkTypes = ['relates', 'refines', 'depends-on', 'parent', 'contradicts'];

const titleTemplates = [
  (a, t) => `Derive ${a} from ${t}`,
  (a, t) => `Centralize ${a} behind ${t}`,
  (a, t) => `Guard ${a} at the data layer, not the routes`,
  (a, t) => `Prefer ${t} over hand-rolled ${a}`,
  (a) => `Make ${a} the single canonical read path`,
  (a, t) => `Enforce ${a} through ${t}`,
  (a) => `Trust objective signals over self-report in ${a}`,
  (a, t) => `Verify ${a} in jsdom, never headless puppeteer`,
  (a) => `Dissolve ${a} into the registry`,
  (a, t) => `Serialize ${a} through ${t}`,
  (a) => `Treat a derived signal in ${a} as part of the control path`,
  (a) => `Strip legacy paths out of ${a}`,
];

const months = ['March', 'April', 'May', 'June'];
const problems = [
  'a component reported failure even when the lifecycle had objectively succeeded',
  'the same value was validated in three places and the copies drifted apart',
  'a hand-rolled primitive produced subtle layout and ordering bugs that only showed under real data',
  'state was threaded through five layers and silently dropped at one of them',
  'an always-empty field gated a path that otherwise succeeded, so good work sealed as failed',
  'the cheap unit check passed while the real end-to-end wiring was quietly broken',
  'two writers raced the same shared resource and corrupted it non-deterministically',
  'a self-report was treated as an authority signal and overrode what actually happened',
];
const metrics = [
  '68% of runs hit the bad path before it was caught',
  'roughly a third of cases were affected',
  'every multi-task batch drifted',
  'the regression survived three releases unnoticed',
  'the failure reproduced on the first end-to-end run but on no unit test',
];
const fixes = [
  'centralize the decision in a single pure function whose signature excludes the untrustworthy input',
  'guard at the data layer and leave route validation, auth, and business logic untouched',
  'derive the signal from objective lifecycle evidence and never from a component’s own narration',
  'lean on an established framework themed to our tokens rather than bespoke behaviour',
  'serialize the conflicting writes through one owner so the shared resource has a single writer',
  'choose the behaviour by tier inversion rather than by hardcoded model name',
  'canonicalize paths and fail before allocation so confinement holds by default',
];
const evidence = [
  'the live full-pipeline smoke harness, which asserts every observable sink, not just the route response',
  'a jsdom mount that exercises real hydration where a headless screenshot could not',
  'a clean-room check against the freshly published artifact rather than the local tree',
  'an end-to-end run against the real daemon that surfaced an ordering bug the mocks hid',
  'a correlated trace joining the HTTP response, diagnostics JSONL, the telemetry queue, and persisted rows',
];
const lessons = [
  'trust what objectively happened in the lifecycle over what a component says about itself',
  'put the guard at the one seam every caller shares, then leave the callers alone',
  'a derived signal a gate depends on is part of the control path, not optional bookkeeping',
  'verify interactivity where React actually hydrates, never from a non-hydrating screenshot',
  'one homogeneous list gets one table; heterogeneous settings each get their own card',
];
const antipatterns = [
  'reintroduces a self-report as an authority signal',
  'hardcodes the behaviour to one tier or one model name',
  'splits the same validation across layers',
  're-derives the contract per call site instead of reading it from one place',
  'lets a second writer touch the shared resource concurrently',
  'gates on a field the lifecycle never populated',
];

function para(...sentences) {
  return sentences.join(' ');
}

function makeBody(area, tech) {
  const context = [
    para(
      `In ${pick(months)} 2026, ${area} exposed a recurring failure mode: ${pick(problems)}.`,
      `The measured impact was real — ${pick(metrics)}.`,
    ),
    para(
      `The adopted fix was to ${pick(fixes)}, implemented with ${tech}.`,
      `That keeps the contract in one place and makes the behaviour identical across every entry point, instead of re-deriving it at each call site where the copies inevitably diverge.`,
    ),
    para(
      `This class keeps recurring, so the durable lesson is blunt: ${pick(lessons)}.`,
      `The strongest evidence came from ${pick(evidence)}, which caught wiring bugs that isolated unit tests never saw because the production plumbing was wrong rather than the local logic.`,
    ),
  ].join('\n\n');

  const consequences = [
    para(
      `${cap(area)} must follow this rule at every entry point.`,
      `Any path that ${pick(antipatterns)} is a regression, because it quietly breaks the guarantee even when a formal check still returns a verdict.`,
    ),
    para(
      `Treat the extra work as the cost of the check — a second, independent perspective on cheap work is still worth more than a fast wrong answer.`,
      `When auditing ${area}, first ask whether the invariant actually held; if it did not, treat the stage as missing its value even though it produced output.`,
    ),
  ].join('\n\n');

  return { context, consequences };
}

const cruxTemplates = [
  (a, t) => `Lean on ${t} for ${a} so the contract lives in exactly one place.`,
  (a) => `${cap(a)} should fail closed and derive from objective state, never self-report.`,
  (a, t) => `The seam for ${a} is ${t} — guard there, once, and leave the callers alone.`,
  (a) => `Keep ${a} identical across every entry point; divergence is the bug.`,
  (a, t) => `${cap(a)} is cheaper to verify end-to-end than to debug after it ships through ${t}.`,
];

// ---- dates ----------------------------------------------------------------
const BASE = Date.UTC(2026, 0, 6, 9, 0, 0); // 2026-01-06
const DAY = 86_400_000;
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const tsStr = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---- build nodes ----------------------------------------------------------
const nodes = [];
for (let i = 1; i <= NODE_COUNT; i++) {
  const area = pick(areas);
  const tech = pick(techs);
  const title = pick(titleTemplates)(area, tech);
  const tags = sample(tagPool, int(4, 9));
  const dateMs = BASE + Math.floor((i - 1) * (150 / NODE_COUNT)) * DAY + int(0, 6) * 3600_000;
  const { context, consequences } = makeBody(area, tech);
  const crux = pick(cruxTemplates)(area, tech);

  // edges to EARLIER nodes; every node past the first links to >=1 so the
  // network is one connected graph.
  const links = [];
  const want = i > 1 ? int(1, 3) : 0;
  const seen = new Set();
  for (let k = 0; k < want; k++) {
    const target = pad(int(1, i - 1));
    if (target === pad(i) || seen.has(target)) continue;
    seen.add(target);
    links.push({ type: pick(linkTypes), target });
  }

  nodes.push({
    id: pad(i),
    title,
    status: 'adopted',
    tags,
    date: dayStr(dateMs),
    links,
    supersededBy: null,
    context,
    consequences,
    crux,
    filename: `nodes/${pad(i)}-${slug(title)}.md`,
    _dateMs: dateMs,
  });
}

// ---- assign non-adopted statuses ------------------------------------------
const SUPERSEDED = 20;
const DROPPED = 6;
const INCONCLUSIVE = 4;

const supersededIdx = sample(nodes.slice(0, NODE_COUNT - 1).map((_, i) => i), SUPERSEDED);
for (const i of supersededIdx) {
  nodes[i].status = 'superseded';
  nodes[i].supersededBy = pad(int(i + 2, NODE_COUNT));
}
const taken = new Set(supersededIdx);
for (const i of sample(nodes.map((_, i) => i).filter((i) => !taken.has(i)), DROPPED)) {
  nodes[i].status = 'dropped';
  taken.add(i);
}
for (const i of sample(nodes.map((_, i) => i).filter((i) => !taken.has(i)), INCONCLUSIVE)) {
  nodes[i].status = 'inconclusive';
}

// ---- build the log --------------------------------------------------------
const log = [];
for (const n of nodes) log.push({ date: tsStr(n._dateMs), op: 'create', id: n.id, title: n.title });
for (const n of nodes) {
  if (n.status === 'superseded') {
    log.push({ date: tsStr(n._dateMs + int(5, 40) * DAY), op: 'supersede', id: n.id, title: n.title });
  }
}
while (log.length < LOG_COUNT) {
  const n = pick(nodes);
  const op = rnd() < 0.85 ? 'refine' : 'merge';
  log.push({ date: tsStr(n._dateMs + int(2, 60) * DAY), op, id: n.id, title: n.title });
}
log.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

// ---- write ----------------------------------------------------------------
const cleanNodes = nodes.map(({ _dateMs, ...n }) => n);
writeFileSync(join(SEED_DIR, 'journal-nodes.json'), JSON.stringify(cleanNodes, null, 2) + '\n');
writeFileSync(join(SEED_DIR, 'journal-log.json'), JSON.stringify(log, null, 2) + '\n');

const byStatus = cleanNodes.reduce((m, n) => ((m[n.status] = (m[n.status] || 0) + 1), m), {});
const edgeCount = cleanNodes.reduce((s, n) => s + n.links.length, 0) + SUPERSEDED;
const avgCtx = Math.round(cleanNodes.reduce((s, n) => s + n.context.length, 0) / cleanNodes.length);
console.log(`wrote ${cleanNodes.length} nodes`, byStatus);
console.log(`~${edgeCount} edges, ${log.length} log entries, avg context ${avgCtx} chars`);
