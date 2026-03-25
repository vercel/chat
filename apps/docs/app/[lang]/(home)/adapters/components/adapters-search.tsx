"use client";

import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

interface AdaptersSearchProps {
  onSearch: (query: string) => void;
}

export const AdaptersSearch = ({ onSearch }: AdaptersSearchProps) => {
  const [query, setQuery] = useState("");

  return (
    <div className="relative">
      <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="Search adapters"
        className="bg-background pl-8 shadow-none"
        onChange={(e) => {
          setQuery(e.target.value);
          onSearch(e.target.value);
        }}
        placeholder="Search adapters..."
        type="text"
        value={query}
      />
    </div>
  );
};
