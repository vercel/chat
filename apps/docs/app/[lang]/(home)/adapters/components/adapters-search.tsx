"use client";

import { SearchIcon } from "lucide-react";
import { useState } from "react";

interface AdaptersSearchProps {
  onSearch: (query: string) => void;
}

export const AdaptersSearch = ({ onSearch }: AdaptersSearchProps) => {
  const [query, setQuery] = useState("");

  return (
    <div className="relative">
      <SearchIcon className="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
      <input
        className="h-12 w-full rounded-lg border bg-background pr-4 pl-12 text-base outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
