import { CodeBlock } from "@vercel/geistdocs/components/code-block";
import type { ThemedToken } from "shiki";
import { cn } from "@/lib/utils";

/**
 * Geistdocs `CodeBlock` with pre-highlighted tokens, stripped of its own
 * margin, border, and radius so it can sit flush inside a window frame.
 */
export const HighlightedCode = ({
  tokens,
  className,
}: {
  tokens: ThemedToken[][];
  className?: string;
}) => (
  <div
    className={cn(
      "overflow-auto text-left [&>div>div]:rounded-none [&>div>div]:border-0 [&>div]:my-0 [&>div]:rounded-none [&_.line]:px-4 [&_pre]:m-0 [&_pre]:rounded-none! [&_pre]:border-0",
      className
    )}
    // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable code must be reachable by keyboard
    tabIndex={0}
  >
    <CodeBlock>
      {tokens.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static token array from shiki
        <span className="line" key={index}>
          {line.map((token) => (
            <span key={token.offset} style={{ color: token.color }}>
              {token.content}
            </span>
          ))}
          {"\n"}
        </span>
      ))}
    </CodeBlock>
  </div>
);
