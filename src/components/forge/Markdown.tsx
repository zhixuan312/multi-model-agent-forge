'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { MermaidDiagram } from '@/components/forge/MermaidDiagram';

/**
 * `Markdown` (Spec 4 / components/forge — F11/F14) — the hardened markdown
 * renderer used by `/spec/document`, the Q&A chatbox, and the `/freeze` cards.
 *
 * STORED-CONTENT TRUST BOUNDARY (F14): member- and model-authored markdown is
 * rendered to OTHER members, so it MUST render with raw HTML DISABLED (no
 * `rehype-raw`, no `dangerouslySetInnerHTML` passthrough) — react-markdown
 * escapes raw HTML by default, and we never add a raw-HTML plugin. Mermaid fences
 * render as INERT, escaped code blocks (`securityLevel:'strict'` intent — never
 * executed script). A hostile ` ```mermaid ` fence or inline `<script>` /
 * `<img onerror=…>` payload therefore renders inert.
 */

/** Mermaid security level — non-executing. A diagram renderer must honor this. */
export const MERMAID_SECURITY_LEVEL = 'strict' as const;

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Render a fenced code block. A ```mermaid fence is rendered inert (a labelled
 * `<pre>` carrying the source verbatim) — never executed. The diagram-rendering
 * upgrade (mermaid lib) is a best-effort enhancement layered on top of this inert
 * baseline and MUST keep `securityLevel:'strict'`.
 */
function CodeBlock(props: ComponentProps<'code'> & { node?: unknown }) {
  const { className, children, node: _node, ...rest } = props;
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
}

/** Minimal hast shape we read to detect a ```mermaid fence + extract its source. */
interface HastNode {
  children?: { properties?: { className?: string[] }; children?: { value?: string }[] }[];
}

/**
 * Block-code wrapper. A ```mermaid fence is rendered as a real diagram
 * (`MermaidDiagram`, strict securityLevel); everything else renders as a normal
 * `<pre>`. Detection reads the AST node so we extract the raw fence source.
 */
function Pre({ node, children }: ComponentProps<'pre'> & { node?: HastNode }) {
  const code = node?.children?.[0];
  const isMermaid = (code?.properties?.className ?? []).includes('language-mermaid');
  if (isMermaid) {
    const source = (code?.children?.[0]?.value ?? '').replace(/\n$/, '');
    return <MermaidDiagram source={source} />;
  }
  return <pre>{children}</pre>;
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('prose prose-sm max-w-none text-ink', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // NO rehype-raw: raw HTML stays escaped (untrusted-content hardening, F14).
        components={{ code: CodeBlock as never, pre: Pre as never }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
