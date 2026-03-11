"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type FilterTab = "all" | "platform" | "state";

interface FilterTabsProps {
  activeTab: FilterTab;
  onTabChange: (tab: FilterTab) => void;
}

export const FilterTabs = ({ activeTab, onTabChange }: FilterTabsProps) => (
  <Tabs
    onValueChange={(value) => onTabChange(value as FilterTab)}
    value={activeTab}
  >
    <TabsList className="w-64 border">
      <TabsTrigger value="all">All</TabsTrigger>
      <TabsTrigger value="platform">Platform</TabsTrigger>
      <TabsTrigger value="state">State</TabsTrigger>
    </TabsList>
  </Tabs>
);

export type { FilterTab };
