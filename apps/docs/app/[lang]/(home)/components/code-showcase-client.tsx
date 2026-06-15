"use client";

import { useState } from "react";
import type { ThemedToken } from "shiki";
import { cn } from "@/lib/utils";
import type { CodeTab } from "../data/code-examples";
import { CodeWindow } from "./code-window";
import { CopyButton } from "./copy-button";
import { HighlightedCode } from "./highlighted-code";

export interface HighlightedTab extends CodeTab {
  tokens: ThemedToken[][];
}

export const CodeShowcaseClient = ({ tabs }: { tabs: HighlightedTab[] }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const safeIndex = activeIndex >= tabs.length ? 0 : activeIndex;
  const activeTab = tabs[safeIndex];

  return (
    <div className="mt-12 pb-10 sm:pb-12">
      <div className="px-6 sm:px-12">
        <CodeWindow
          filename={activeTab.filename}
          headerRight={<CopyButton code={activeTab.code} />}
          key={safeIndex}
        >
          <HighlightedCode tokens={activeTab.tokens} />
        </CodeWindow>
      </div>
      <div className="mt-12 grid grid-cols-2 border-gray-200 border-b bg-background-200 sm:grid-cols-4">
        {tabs.map((tab, index) => (
          <button
            className={cn(
              "border-gray-200 border-t px-7 py-4 text-left font-mono text-xs transition-colors sm:px-4",
              // 2-col (mobile): left divider on the right column.
              index % 2 === 1 && "border-l",
              // 4-col (sm+): left divider on the 3rd column.
              index % 4 === 2 && "sm:border-l",
              safeIndex === index
                ? "bg-background-100 font-medium text-gray-1000"
                : "text-gray-900 hover:bg-background-100 hover:text-gray-1000"
            )}
            key={tab.label}
            onClick={() => setActiveIndex(index)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
};
