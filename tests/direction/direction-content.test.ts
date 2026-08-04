import * as reference from '@/content/direction-reference';
import {
  DIRECTION_SECTIONS,
  MASTHEAD_STATEMENT,
  PARTS,
} from '@/content/direction-sections';

const expectedIds = [
  'insight-and-bet', 'principles', 'reviewed-lifecycle', 'one-engine-two-modes',
  'what-we-wont-do', 'routing-two-slots', 'tool-audit', 'tool-review', 'tool-debug',
  'tool-investigate', 'tool-research', 'tool-spec', 'tool-plan', 'tool-delegate',
  'tool-execute-plan', 'tool-journal-recall', 'tool-orchestrate', 'tool-journal-record',
  'provider-runtimes',
  'cache-tokens', 'bounded-execution', 'tool-context-block', 'tool-retry', 'tool-task-poll',
  'forge-role', 'forge-spine', 'forge-automation', 'forge-collaboration', 'telemetry-role',
  'telemetry-evidence-model', 'telemetry-honest-null', 'telemetry-public-gated',
];

describe('Forge direction content', () => {
  it('preserves the five ordered parts and every stable section id', () => {
    expect(PARTS).toEqual([
      { part: 'product', title: 'The product' },
      { part: 'engine', title: 'The engine · shared by both modes' },
      { part: 'backend', title: 'The backend · how the engine runs' },
      { part: 'forge', title: 'Forge · the team app' },
      { part: 'telemetry', title: 'Telemetry · proof surface' },
    ]);
    expect(DIRECTION_SECTIONS.map((section) => section.id)).toEqual(expectedIds);
    expect(new Set(DIRECTION_SECTIONS.map((section) => section.id)).size).toBe(expectedIds.length);
    expect(DIRECTION_SECTIONS[0]).toMatchObject({ id: 'insight-and-bet', part: 'product' });
    expect(MASTHEAD_STATEMENT).toContain('full AI software development lifecycle');
  });

  it('keeps the frozen structured reference exports available', () => {
    expect(Object.keys(reference).sort()).toEqual([
      'AGENT_LAYERS', 'JOURNAL_RECALL', 'JOURNAL_RECORD', 'JOURNAL_STORE', 'JOURNAL_TYPES',
      'LIFECYCLE_STAGES', 'PRINCIPLES', 'READ_ROUTES', 'RESEARCH_SOURCES', 'WRITE_STAGES',
    ]);
  });

  it('updates only the legacy host framing without trimming the manual', () => {
    const manual = DIRECTION_SECTIONS.map((section) => section.body).join('\n');
    expect(manual).toContain('authenticated Forge');
    expect(manual).not.toMatch(/served by the telemetry surface/i);
    expect(manual).not.toMatch(/global north star above all three/i);
    expect(DIRECTION_SECTIONS.some((section) => section.part === 'product')).toBe(true);
    expect(DIRECTION_SECTIONS.some((section) => section.part === 'engine')).toBe(true);
    expect(DIRECTION_SECTIONS.some((section) => section.part === 'backend')).toBe(true);
    expect(DIRECTION_SECTIONS.some((section) => section.part === 'forge')).toBe(true);
    expect(DIRECTION_SECTIONS.some((section) => section.part === 'telemetry')).toBe(true);
  });
});
