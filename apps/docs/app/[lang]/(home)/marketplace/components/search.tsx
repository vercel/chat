"use client";

import { SearchIcon } from "lucide-react";
import { useState, useTransition } from "react";

interface MarketplaceSearchProps {
  onSearch: (query: string) => void;
}

export const MarketplaceSearch = ({ onSearch }: MarketplaceSearchProps) => {
  const [query, setQuery] = useState("");

  return (
    <div className="relative">
      <SearchIcon className="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder="Search adapters..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onSearch(e.target.value);
        }}
        className="h-12 w-full rounded-lg border bg-background pl-12 pr-4 text-base outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      />
    </div>
  );
};
