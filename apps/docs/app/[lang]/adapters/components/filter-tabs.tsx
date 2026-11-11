"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type FilterTab = "all" | "platform" | "state";

// The tabs filter the adapter list rendered by AdaptersGrid rather than
// switching Radix TabsContent panels, so point them at that list.
export const FILTER_RESULTS_ID = "adapters-results";

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
      <TabsTrigger aria-controls={FILTER_RESULTS_ID} value="all">
        All
      </TabsTrigger>
      <TabsTrigger aria-controls={FILTER_RESULTS_ID} value="platform">
        Platform
      </TabsTrigger>
      <TabsTrigger aria-controls={FILTER_RESULTS_ID} value="state">
        State
      </TabsTrigger>
    </TabsList>
  </Tabs>
);

export type { FilterTab };
