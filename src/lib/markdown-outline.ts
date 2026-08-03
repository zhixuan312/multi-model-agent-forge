/**
 * Parsing a two-level markdown outline — `##` containers holding `###` sections.
 *
 * Spec files and plan files have the same shape (spec: components holding sections; plan:
 * phases holding tasks) and had a parser each. The two were the same forty lines twice:
 * identical code-fence toggling, identical flush-on-heading bookkeeping, identical
 * startLine/endLine arithmetic, identical tail flush. Only three things actually differed —
 * which `###` lines count as a section, whether prose directly under a container counts as
 * one, and whether the container is called a "component" or a "phase".
 *
 * That mattered because the line arithmetic here is load-bearing: `replaceTaskSection`
 * splices a file using `startLine`/`endLine`, so an off-by-one is a corrupted plan.md. Two
 * copies meant fixing that in one and not the other.
 */

/** A `###` section, with the `##` container it appeared under. */
export interface OutlineSection {
  /** The `##` container heading text, with its marker stripped. `''` when none precedes. */
  container: string;
  /** The literal heading line, marker included (`### Background`). */
  heading: string;
  /** Everything between this heading and the next, trimmed. */
  body: string;
  /** Index of the heading line in the source. */
  startLine: number;
  /** Index of this section's last line — the line before the next heading. */
  endLine: number;
}

export interface OutlineOptions {
  /**
   * Which `###` lines open a section. Spec accepts any; plan requires a task-shaped title,
   * so a stray `### Note` inside a task stays part of that task's body.
   */
  itemHeading: RegExp;
  /**
   * When set, prose appearing directly under a container with no `###` of its own becomes
   * an implicit section titled after the container. Spec files rely on this (a component
   * may be written as a single unheaded block); plan files do not.
   */
  implicitSection?: boolean;
}

const CONTAINER_HEADING_RE = /^## .+/;

/**
 * Split `md` into its `###` sections.
 *
 * Content inside a ``` fence is never treated as a heading — a fenced markdown example
 * containing `## Foo` would otherwise silently split the document.
 *
 * Note there is no "and not an item heading" guard on the container test: `/^## .+/`
 * requires a space in the third position, so a `###` line cannot match it. Both original
 * parsers carried that guard; it never fired.
 */
export function parseMarkdownOutline(md: string, opts: OutlineOptions): OutlineSection[] {
  const lines = md.split('\n');
  const sections: OutlineSection[] = [];
  let container = '';
  let current: { container: string; heading: string; startLine: number; bodyLines: string[] } | null = null;
  let inCodeFence = false;

  const flush = (endLine: number) => {
    if (!current) return;
    sections.push({
      container: current.container,
      heading: current.heading,
      body: current.bodyLines.join('\n').trim(),
      startLine: current.startLine,
      endLine,
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence;
      if (current) current.bodyLines.push(line);
      continue;
    }
    if (inCodeFence) {
      if (current) current.bodyLines.push(line);
      continue;
    }

    if (CONTAINER_HEADING_RE.test(line)) {
      flush(i - 1);
      container = line.replace(/^##\s*/, '').trim();
    } else if (opts.itemHeading.test(line)) {
      flush(i - 1);
      current = { container, heading: line, startLine: i, bodyLines: [] };
    } else if (opts.implicitSection && !current && container && line.trim() && !line.startsWith('#')) {
      current = { container, heading: `### ${container}`, startLine: i, bodyLines: [line] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  flush(lines.length - 1);

  return sections;
}
