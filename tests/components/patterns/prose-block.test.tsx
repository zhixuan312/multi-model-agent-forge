import { render, screen } from '@testing-library/react';
import { ProseBlock } from '@/components/patterns/prose-block';

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
});
