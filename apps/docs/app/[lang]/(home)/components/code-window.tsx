import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const CodeWindow = ({
  children,
  filename,
  headerRight,
  className,
}: {
  children: ReactNode;
  filename: string;
  headerRight?: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex min-w-0 flex-col overflow-hidden rounded-lg shadow-sm",
      className
    )}
  >
    <div className="relative flex h-12 items-center rounded-t-lg border border-gray-200 border-b-0 bg-background-100 p-3">
      <div className="flex gap-1.5">
        <span className="inline-block size-2 rounded-full bg-[#EE6D5E]" />
        <span className="inline-block size-2 rounded-full bg-[#F3BF4A]" />
        <span className="inline-block size-2 rounded-full bg-[#5DC753]" />
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 max-sm:hidden">
        <span className="font-mono text-gray-900 text-xs">{filename}</span>
      </div>
      {headerRight ? (
        <div className="ml-auto flex items-center gap-1.5">{headerRight}</div>
      ) : null}
    </div>
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-b-lg border border-gray-200 bg-background-100">
      <div className="[&_pre]:!overflow-x-hidden h-56 overflow-y-auto">
        {children}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-lg bg-gradient-to-t from-background-100 to-transparent" />
    </div>
  </div>
);
