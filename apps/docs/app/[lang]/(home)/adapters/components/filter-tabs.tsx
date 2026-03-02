"use client";

import { cn } from "@/lib/utils";

type FilterTab = "all" | "platform" | "state";

interface FilterTabsProps {
  activeTab: FilterTab;
  onTabChange: (tab: FilterTab) => void;
}

const tabs: { label: string; value: FilterTab }[] = [
  { label: "All", value: "all" },
  { label: "Platform", value: "platform" },
  { label: "State", value: "state" },
];

export const FilterTabs = ({ activeTab, onTabChange }: FilterTabsProps) => (
  <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
    {tabs.map((tab) => (
      <button
        className={cn(
          "rounded-md px-3 py-1.5 font-medium text-sm transition-colors",
          activeTab === tab.value
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        key={tab.value}
        onClick={() => onTabChange(tab.value)}
        type="button"
      >
        {tab.label}
      </button>
    ))}
  </div>
);

export type { FilterTab };
