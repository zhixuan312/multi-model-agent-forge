import { describe, it, expect } from 'vitest';
import { parseSpecSections } from '@/spec/spec-file-ops';

describe('parseSpecSections', () => {
  it('parses ### headings under ## components', () => {
    const md = `# Project — Specification

## Context

### Background

The team builds software.

### Timeline

| Milestone | Date |
|-----------|------|
| Demo | Friday |

## Problem

### Problem

The demo requires a database.
`;
    const sections = parseSpecSections(md);
    expect(sections).toHaveLength(3);
    expect(sections[0].component).toBe('Context');
    expect(sections[0].heading).toBe('### Background');
    expect(sections[0].body).toContain('builds software');
    expect(sections[1].component).toBe('Context');
    expect(sections[1].heading).toBe('### Timeline');
    expect(sections[1].body).toContain('Demo');
    expect(sections[2].component).toBe('Problem');
    expect(sections[2].heading).toBe('### Problem');
    expect(sections[2].body).toContain('database');
  });

  it('handles single-section components (no ### heading, content under ##)', () => {
    const md = `# Spec

## Problem

The demo requires a database. This is a problem.
`;
    const sections = parseSpecSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].component).toBe('Problem');
    expect(sections[0].body).toContain('database');
  });

  it('skips content inside code fences', () => {
    const md = `# Spec

## Technical Design

### Current state

\`\`\`mermaid
flowchart TD
  ## This is NOT a component heading
  ### This is NOT a section heading
\`\`\`

Real content here.

### Proposed design

New architecture.
`;
    const sections = parseSpecSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('### Current state');
    expect(sections[0].body).toContain('mermaid');
    expect(sections[0].body).toContain('Real content');
    expect(sections[1].heading).toBe('### Proposed design');
    expect(sections[1].body).toContain('New architecture');
  });

  it('returns empty for spec with no ## headings', () => {
    expect(parseSpecSections('# Just a title\n\nSome text.')).toEqual([]);
  });

  it('handles spec with metadata preamble', () => {
    const md = `# db — Specification

- Visibility: public
- Components: Context, Problem
- Version: 5

## Context

### Background

Background content.
`;
    const sections = parseSpecSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].component).toBe('Context');
    expect(sections[0].body).toContain('Background content');
  });

  it('parses a subset-formatted spec whose selected component has body text but no explicit ### subsections', () => {
    const md = `# Spec

## Context

### Background

Background content.

## Risks & Mitigations

_No additional sections were required for this draft._
`;
    const sections = parseSpecSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[1].component).toBe('Risks & Mitigations');
    expect(sections[1].body).toContain('No additional sections');
  });
});
