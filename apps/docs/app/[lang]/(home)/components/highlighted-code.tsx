import type { CSSProperties } from "react";
import type { ThemedToken } from "shiki";
import { cn } from "@/lib/utils";

export const HighlightedCode = ({
  tokens,
  className,
}: {
  tokens: ThemedToken[][];
  className?: string;
}) => (
  <pre
    className={cn(
      "overflow-x-auto bg-transparent py-5 font-mono text-[13px] leading-5 [font-feature-settings:'ss09']",
      className
    )}
  >
    <code className="grid min-w-max">
      {tokens.map((line, lineIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static token array from shiki
        <span className="line px-5" key={lineIndex}>
          {line.length > 0
            ? line.map((token, tokenIndex) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: static token array from shiki
                  key={tokenIndex}
                  style={{ color: token.color } as CSSProperties}
                >
                  {token.content}
                </span>
              ))
            : "\n"}
        </span>
      ))}
    </code>
  </pre>
);
