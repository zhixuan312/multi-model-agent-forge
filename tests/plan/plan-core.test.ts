import { describe, it, expect } from 'vitest';
import { findTaskSection, parsePlanSections } from '@/plan/plan-file-ops';
import { groupTasksIntoPhases } from '@/plan/plan-core';

describe('parsePlanSections', () => {
  it('parses ### headings into task sections', () => {
    const md = `# Plan

### Task 1: Add the widget

**Files:**
- Create: \`src/widget.ts\`

Some detail here.

### Task 2: Wire handler

Handler wiring detail.
`;
    const sections = parsePlanSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('### Task 1: Add the widget');
    expect(sections[0].body).toContain('src/widget.ts');
    expect(sections[1].heading).toBe('### Task 2: Wire handler');
    expect(sections[1].body).toContain('Handler wiring');
  });

  it('handles plan with header block before first task', () => {
    const md = `# My Plan

**Goal:** Build the thing.

---

### Task 1: First

Do it.
`;
    const sections = parsePlanSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('### Task 1: First');
  });

  it('returns empty for plan with no ### headings', () => {
    const md = `# Just a title\n\nSome text.`;
    expect(parsePlanSections(md)).toEqual([]);
  });

  it('extracts files from task body', () => {
    const md = `### Task 1: Test

**Files:**
- Create: \`src/foo.ts\`
- Modify: \`src/bar.ts:10-20\`
- Test: \`tests/foo.test.ts\`

- [ ] **Step 1: Write the test**
`;
    const sections = parsePlanSections(md);
    expect(sections[0].body).toContain('src/foo.ts');
  });

  it('parses mma-plan headings grouped under ## track headings', () => {
    const md = `# Plan

## Track 1 — Contract

### Task I-1: Extend the route surface

**Files:**
- Modify: \`src/mma/client.ts\`

- [ ] **Step 1: Write the failing test**

## Track 2 — Authoring

### Task I-2: Swap the route

Detail.
`;
    const sections = parsePlanSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].phase).toBe('Track 1 — Contract');
    expect(sections[1].phase).toBe('Track 2 — Authoring');
  });
});

describe('groupTasksIntoPhases', () => {
  it('groups tasks into a single phase when no phase markers exist', () => {
    const tasks = [
      { id: 't1', num: 1, title: 'Task 1', body: '', files: [], dependsOn: [], targetRepo: 'r' },
      { id: 't2', num: 2, title: 'Task 2', body: '', files: [], dependsOn: [], targetRepo: 'r' },
    ];
    const phases = groupTasksIntoPhases(tasks);
    expect(phases).toHaveLength(1);
    expect(phases[0].title).toBe('Implementation');
    expect(phases[0].tasks).toHaveLength(2);
  });

  it('groups tasks by phase field when present', () => {
    const tasks = [
      { id: 't1', num: 1, title: 'Task 1', body: '', files: [], dependsOn: [], targetRepo: 'r', phase: 'Track A' },
      { id: 't2', num: 2, title: 'Task 2', body: '', files: [], dependsOn: [], targetRepo: 'r', phase: 'Track A' },
      { id: 't3', num: 3, title: 'Task 3', body: '', files: [], dependsOn: [], targetRepo: 'r', phase: 'Track B' },
    ];
    const phases = groupTasksIntoPhases(tasks);
    expect(phases).toHaveLength(2);
    expect(phases[0].title).toBe('Track A');
    expect(phases[0].tasks).toHaveLength(2);
    expect(phases[1].title).toBe('Track B');
  });

  it('returns empty array for empty tasks', () => {
    expect(groupTasksIntoPhases([])).toEqual([]);
  });
});

describe('findTaskSection — which section a stored task title refers to', () => {
  // `TASK_HEADING_RE` takes `### Task …` or `### <CAPS/digits><separator>…`, so these are
  // the unnumbered-but-valid form. A plain `### Setup` is not a task heading at all.
  const md = [
    '## Phase 1',
    '',
    '### Task Setup and teardown',
    '',
    'The long one.',
    '',
    '### Task Setup',
    '',
    'The short one.',
    '',
  ].join('\n');
  const sections = parsePlanSections(md);

  it('found both headings — a broken parse would make the rest of this vacuous', () => {
    expect(sections.map((s) => s.heading)).toEqual(['### Task Setup and teardown', '### Task Setup']);
  });

  /**
   * The old rule was `heading.includes(taskTitle)`, first match wins. "Setup" is a substring
   * of "Setup and teardown", and that one comes first — so refining the task called "Setup"
   * located the OTHER task, and `replaceTaskSection` overwrites the section it locates.
   * Numbered `Task N:` headings hide this, but `TASK_HEADING_RE` accepts unnumbered ones.
   */
  it('takes the exactly-matching heading, not an earlier one that merely contains it', () => {
    expect(findTaskSection(sections, 'Task Setup')!.body.trim()).toBe('The short one.');
    expect(findTaskSection(sections, 'Task Setup and teardown')!.body.trim()).toBe('The long one.');
  });

  it('still finds a task whose stored title only appears inside its heading', () => {
    // The tolerance the substring rule bought — a plan.md edited by hand — is kept.
    const numbered = parsePlanSections('### Task 5: Add the parser\n\nbody\n');
    expect(findTaskSection(numbered, 'Add the parser')!.heading).toBe('### Task 5: Add the parser');
  });

  it('refuses to guess when a loose match is ambiguous', () => {
    const two = parsePlanSections('### Task 1: Add the parser\n\na\n\n### Task 2: Add the parser tests\n\nb\n');
    expect(findTaskSection(two, 'Add the parser')).toBeNull();
  });

  /**
   * Two tasks with one title is the plausible case — a plan.md with a repeated `### Task 3:`
   * heading. The old rule silently picked the first and overwrote it.
   */
  it('refuses when two sections carry the SAME title — it identifies nothing', () => {
    const dup = parsePlanSections('### Task 3: Setup\n\na\n\n### Task 3: Setup\n\nb\n');
    expect(findTaskSection(dup, 'Task 3: Setup')).toBeNull();
  });

  it('is null for a title that is not there at all', () => {
    expect(findTaskSection(sections, 'Nope')).toBeNull();
  });

  /** The destructive half: a wrong-section match here overwrites a task body. */
  it('replaceTaskSection cannot land on a section the title does not name', () => {
    expect(findTaskSection(sections, 'Task Setup')!.startLine).toBe(
      sections.find((s) => s.heading === '### Task Setup')!.startLine,
    );
  });
});
