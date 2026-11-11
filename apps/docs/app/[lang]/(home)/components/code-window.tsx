import type { ThemedToken } from "shiki";
import { cn } from "@/lib/utils";
import { HighlightedCode } from "./highlighted-code";

export function CodeWindow({
  className,
  codeClassName,
  filename,
  tokens,
}: {
  className?: string;
  codeClassName?: string;
  filename: string;
  tokens: ThemedToken[][];
}) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-gray-400 bg-background-100 shadow-sm",
        className
      )}
    >
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-gray-400 border-b px-4 py-2">
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className="flex gap-1.5">
            <span className="size-2 rounded-full bg-[#ee6d5e]" />
            <span className="size-2 rounded-full bg-[#f3bf4a]" />
            <span className="size-2 rounded-full bg-[#5dc753]" />
          </span>
          <span className="font-mono text-gray-900 text-xs">{filename}</span>
        </span>
      </div>
      <HighlightedCode className={codeClassName} tokens={tokens} />
    </div>
  );
}
