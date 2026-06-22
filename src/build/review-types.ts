/**
 * Review-stage view types. After Execute lands the commits, MMA's code-review
 * (or a human) reviews the changeset. The shape mirrors the spec/plan audit:
 * numbered, selectable findings with severity + file location.
 */

export interface ReviewUnit {
  id: string;
  num: number;
  title: string;
  repo: string;
  files: string[];
  commit: string;
}

export interface ReviewFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  claim: string;
  location: string;
}
