import { describe, it, expect } from 'vitest';
import { parsePlanSections } from '@/plan/plan-file-ops';
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
