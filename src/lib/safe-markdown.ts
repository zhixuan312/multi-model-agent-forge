export function sanitizeUserVisibleMarkdown(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
