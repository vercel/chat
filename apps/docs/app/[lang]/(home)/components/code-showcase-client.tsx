"use client";

import { useState } from "react";
import type { ThemedToken } from "shiki";
import { SlidingTabs } from "@/components/ui/sliding-tabs";
import { cn } from "@/lib/utils";
import type { CodeTab } from "../data/code-examples";
import { CodeWindow } from "./code-window";
import { CopyButton } from "./copy-button";
import { HighlightedCode } from "./highlighted-code";

export interface HighlightedTab extends CodeTab {
  tokens: ThemedToken[][];
}

/** Tabs shown at once; the rest move to the next dot-selected group. */
const TABS_PER_GROUP = 4;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
};

export const CodeShowcaseClient = ({ tabs }: { tabs: HighlightedTab[] }) => {
  const groups = chunk(tabs, TABS_PER_GROUP);
  const [groupIndex, setGroupIndex] = useState(0);
  const safeGroupIndex = groupIndex >= groups.length ? 0 : groupIndex;
  const groupTabs = groups[safeGroupIndex] ?? tabs;
  const [activeLabel, setActiveLabel] = useState(tabs[0]?.label ?? "");
  const activeTab =
    groupTabs.find((tab) => tab.label === activeLabel) ?? groupTabs[0];

  const selectGroup = (index: number) => {
    setGroupIndex(index);
    const firstLabel = groups[index]?.[0]?.label;
    if (firstLabel) {
      setActiveLabel(firstLabel);
    }
  };

  return (
    <div>
      <SlidingTabs.Root
        className="mb-4"
        onValueChange={setActiveLabel}
        value={activeTab.label}
      >
        <SlidingTabs.List aria-label="Code examples">
          {groupTabs.map((tab) => (
            <SlidingTabs.Tab key={tab.label} value={tab.label}>
              {tab.label}
            </SlidingTabs.Tab>
          ))}
          <SlidingTabs.Indicator />
        </SlidingTabs.List>
      </SlidingTabs.Root>

      <CodeWindow
        filename={activeTab.filename}
        headerRight={<CopyButton code={activeTab.code} />}
        key={activeTab.label}
      >
        <HighlightedCode tokens={activeTab.tokens} />
      </CodeWindow>

      {groups.length > 1 ? (
        <div
          aria-label="Select example group"
          className="mt-4 flex items-center justify-center"
          role="tablist"
        >
          {groups.map((group, index) => {
            const isActive = index === safeGroupIndex;
            return (
              <button
                aria-label={`Examples ${index + 1}`}
                aria-selected={isActive}
                className={cn(
                  "flex items-center justify-center p-2",
                  index === groups.length - 1 && "-ml-1"
                )}
                key={group[0]?.label ?? index}
                onClick={() => selectGroup(index)}
                role="tab"
                type="button"
              >
                <span
                  className={cn(
                    "size-2 rounded-full transition-colors",
                    isActive ? "bg-gray-900" : "bg-gray-500"
                  )}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
