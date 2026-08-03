'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Children, Fragment, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { sanitizeUserVisibleMarkdown } from '@/lib/safe-markdown';
import { MermaidDiagram } from '@/components/patterns/mermaid-diagram';

const VARIANT_CLASSES = {
  document:
    'prose prose-sm max-w-none text-ink',
  rail:
    'prose prose-sm max-w-none text-ink min-w-0 ' +
    'prose-headings:mt-0 prose-headings:mb-2 prose-h3:text-sm prose-h3:font-semibold prose-h3:text-ink ' +
    'prose-p:my-1.5 prose-p:text-xs prose-p:leading-relaxed prose-p:text-ink-soft ' +
    'prose-strong:text-ink prose-strong:font-semibold ' +
    'prose-ul:my-1.5 prose-ul:pl-4 prose-ul:list-disc ' +
    'prose-li:my-0.5 prose-li:text-xs prose-li:text-ink-soft prose-li:marker:text-accent ' +
    'prose-hr:my-3 prose-hr:border-accent-tint ' +
    'prose-code:rounded prose-code:bg-accent-tint/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.7rem] ' +
    'prose-code:font-medium prose-code:text-accent-deep prose-code:before:content-none prose-code:after:content-none',
  compact:
    'prose prose-sm max-w-none text-ink ' +
    'prose-headings:mt-0 prose-headings:mb-1 ' +
    'prose-p:my-0.5 prose-p:text-xs prose-p:text-ink-soft ' +
    'prose-ul:my-0.5 prose-ul:pl-3',
  chat:
    'prose prose-sm max-w-none text-ink ' +
    'prose-p:my-0 prose-p:text-sm ' +
    'prose-headings:mt-1 prose-headings:mb-0.5 ' +
    'prose-ul:my-1 prose-ul:pl-4',
} as const;

export type ProseVariant = keyof typeof VARIANT_CLASSES;

function CodeBlock(props: ComponentProps<'code'> & { node?: unknown }) {
  const { className, children, node: _node, ...rest } = props;
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
}

interface HastNode {
  children?: { properties?: { className?: string[] }; children?: { value?: string }[] }[];
}

function Pre({ node, children }: ComponentProps<'pre'> & { node?: HastNode }) {
  const code = node?.children?.[0];
  const isMermaid = (code?.properties?.className ?? []).includes('language-mermaid');
  if (isMermaid) {
    const source = (code?.children?.[0]?.value ?? '').replace(/\n$/, '');
    return <MermaidDiagram source={source} />;
  }
  return <pre>{children}</pre>;
}

export interface ProseBlockProps {
  children: string;
  variant?: ProseVariant;
  className?: string;
  /**
   * Decorate plain-text runs of the rendered markdown — e.g. highlighting @-mentions.
   *
   * Applied to STRING children only, so it never sees markup and cannot inject any: it
   * receives text react-markdown has already parsed out, and whatever it returns is React
   * nodes, not HTML. Without this a caller has to choose between markdown and its own text
   * pass, which is how `DiscussionThread` came to render the author's own messages as plain
   * text (mentions highlighted, markdown raw) and everyone else's as markdown (markdown
   * rendered, mentions not) — the same message shown two different ways depending on who was
   * looking.
   */
  highlight?: (text: string) => ReactNode;
}

/** Map a component's children, passing every string run through `highlight`. */
function decorate(children: ReactNode, highlight: (t: string) => ReactNode): ReactNode {
  return Children.map(children, (child, i) =>
    typeof child === 'string' ? <Fragment key={i}>{highlight(child)}</Fragment> : child,
  );
}

export function ProseBlock({ children, variant = 'document', className, highlight }: ProseBlockProps) {
  // Only the elements that carry prose. Headings and code are deliberately excluded: a
  // mention inside a fenced block is text the author typed as code, not a reference.
  const decorated = highlight
    ? {
        p: ({ children: c }: { children?: ReactNode }) => <p>{decorate(c, highlight)}</p>,
        li: ({ children: c }: { children?: ReactNode }) => <li>{decorate(c, highlight)}</li>,
        strong: ({ children: c }: { children?: ReactNode }) => <strong>{decorate(c, highlight)}</strong>,
        em: ({ children: c }: { children?: ReactNode }) => <em>{decorate(c, highlight)}</em>,
        td: ({ children: c }: { children?: ReactNode }) => <td>{decorate(c, highlight)}</td>,
      }
    : {};

  return (
    <div className={cn(VARIANT_CLASSES[variant], className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ code: CodeBlock as never, pre: Pre as never, ...decorated }}
      >
        {sanitizeUserVisibleMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}
