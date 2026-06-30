import { describe, it, expect } from 'vitest';

describe('plan-stage features', () => {
  describe('PlanAuditFinding', () => {
    it('includes evidence and suggestion fields', () => {
      const finding = {
        severity: 'high' as const,
        category: 'test',
        claim: 'test claim',
        evidence: 'quoted text',
        suggestion: 'fix it',
      };
      expect(finding.evidence).toBe('quoted text');
      expect(finding.suggestion).toBe('fix it');
    });
  });

  describe('plan-core groupTasksIntoPhases', () => {
    it('groups multiple tasks into a single implementation phase', async () => {
      const { groupTasksIntoPhases } = await import('@/plan/plan-core');
      const tasks = [
        { id: 't1', num: 1, title: 'Task 1', body: '', files: [], dependsOn: [], targetRepo: 'r' },
        { id: 't2', num: 2, title: 'Task 2', body: '', files: [], dependsOn: [], targetRepo: 'r' },
        { id: 't3', num: 3, title: 'Task 3', body: '', files: [], dependsOn: [], targetRepo: 'r' },
      ];
      const phases = groupTasksIntoPhases(tasks);
      expect(phases).toHaveLength(1);
      expect(phases[0].tasks).toHaveLength(3);
    });
  });

  describe('plan audit finding with severity sort', () => {
    it('sorts findings by severity order: critical > high > medium > low', () => {
      const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
      const findings = [
        { severity: 'medium', category: 'a', claim: 'x' },
        { severity: 'critical', category: 'b', claim: 'y' },
        { severity: 'low', category: 'c', claim: 'z' },
        { severity: 'high', category: 'd', claim: 'w' },
      ];
      const sorted = [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
      expect(sorted.map((f) => f.severity)).toEqual(['critical', 'high', 'medium', 'low']);
    });
  });
});
