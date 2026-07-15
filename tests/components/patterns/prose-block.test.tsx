import { render, screen } from '@testing-library/react';
import { ProseBlock } from '@/components/patterns/prose-block';
import { sanitizeUserVisibleMarkdown } from '@/lib/safe-markdown';

describe('sanitizeUserVisibleMarkdown', () => {
  it('normalizes CRLF to LF and trims, without touching < or >', () => {
    expect(sanitizeUserVisibleMarkdown('line 1\r\n<script>alert(1)</script>\r\n')).toBe(
      'line 1\n<script>alert(1)</script>',
    );
  });

  it('preserves angle brackets in code spans (react-markdown renders them safely)', () => {
    expect(sanitizeUserVisibleMarkdown('use `<projectId>` and `a -> b`')).toBe(
      'use `<projectId>` and `a -> b`',
    );
  });
});

describe('ProseBlock', () => {
  it('renders markdown content as HTML', () => {
    render(<ProseBlock variant="document">**bold text**</ProseBlock>);
    expect(screen.getByText('bold text')).toBeInTheDocument();
    expect(screen.getByText('bold text').tagName).toBe('STRONG');
  });

  it('applies document variant — full prose scale', () => {
    const { container } = render(<ProseBlock variant="document"># Heading</ProseBlock>);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain('prose');
    expect(wrapper.className).toContain('max-w-none');
  });

  it('applies rail variant — compact prose for side panels', () => {
    const { container } = render(<ProseBlock variant="rail">### Small heading</ProseBlock>);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain('prose-h3:text-sm');
  });

  it('applies compact variant — minimal spacing', () => {
    const { container } = render(<ProseBlock variant="compact">A note.</ProseBlock>);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain('prose-p:my-0.5');
  });

  it('applies chat variant — tight paragraphs', () => {
    const { container } = render(<ProseBlock variant="chat">Hello</ProseBlock>);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain('prose-p:my-0');
  });

  it('does not render raw HTML (security)', () => {
    render(<ProseBlock variant="document">{'<script>alert("xss")</script>'}</ProseBlock>);
    expect(document.querySelector('script')).toBeNull();
  });

  it('accepts optional className', () => {
    const { container } = render(<ProseBlock variant="document" className="mt-4">Hi</ProseBlock>);
    expect(container.firstElementChild!.className).toContain('mt-4');
  });

  it('defaults to document variant when unspecified', () => {
    const { container } = render(<ProseBlock>Hi</ProseBlock>);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain('max-w-none');
  });

  it('renders escaped raw HTML as text, not DOM nodes', () => {
    render(<ProseBlock variant="chat">{'hello <script>alert(1)</script>'}</ProseBlock>);
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/hello/)).toBeInTheDocument();
    expect(screen.getByText(/alert\(1\)/)).toBeInTheDocument();
  });
});
