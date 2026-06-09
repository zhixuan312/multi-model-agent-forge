import { render, screen } from '@testing-library/react';
import { Markdown } from '@/components/forge/Markdown';

describe('Markdown (untrusted-content hardening, F14)', () => {
  it('renders inline <script> inert — raw HTML is escaped, not injected', () => {
    const hostile = 'Hello <script>window.__xss = true</script> world';
    const { container } = render(<Markdown>{hostile}</Markdown>);
    // No <script> element was injected into the DOM.
    expect(container.querySelector('script')).toBeNull();
    // The script payload did not execute.
    expect((window as unknown as { __xss?: boolean }).__xss).not.toBe(true);
  });

  it('renders <img onerror=…> inert — no img element with an onerror handler is created', () => {
    const hostile = 'X <img src=x onerror="window.__xss2=true"> Y';
    const { container } = render(<Markdown>{hostile}</Markdown>);
    const img = container.querySelector('img');
    // react-markdown without rehype-raw does NOT create the raw <img>.
    expect(img).toBeNull();
    expect((window as unknown as { __xss2?: boolean }).__xss2).not.toBe(true);
  });

  it('renders a ```mermaid fence as an INERT block (securityLevel strict), never executed', () => {
    const md = '```mermaid\ngraph TD; A-->B;\n```';
    const { container } = render(<Markdown>{md}</Markdown>);
    const block = container.querySelector('[data-mermaid]');
    expect(block).toBeInTheDocument();
    expect(block).toHaveAttribute('data-security-level', 'strict');
    expect(block?.textContent).toContain('graph TD');
  });

  it('renders ordinary markdown (a heading)', () => {
    render(<Markdown>{'# Title\n\nbody'}</Markdown>);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
  });
});
