/**
 * Normalize markdown for the `ProseBlock` renderer — CRLF → LF and trim only.
 *
 * We deliberately do NOT escape `<`/`>`. `ProseBlock` renders through react-markdown
 * with remark-gfm and NO rehype-raw, so raw HTML is already rendered as inert text —
 * `<script>` never becomes a DOM node (see prose-block.test.tsx "security" cases).
 * The old blanket `<`→`&lt;` / `>`→`&gt;` escape corrupted legitimate content: inside a
 * code span CommonMark does not decode entities, so `` `<projectId>` `` and `->` rendered
 * as the literal `&lt;projectId&gt;` / `-&gt;`. Normalization is all that belongs here;
 * safety is the renderer's job.
 */
export function sanitizeUserVisibleMarkdown(input: string): string {
  return input.replace(/\r\n/g, '\n').trim();
}
