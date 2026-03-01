"use client";

import { useState } from "react";
import { AdapterCard } from "./adapter-card";
import { MarketplaceSearch } from "./search";

interface Adapter {
  name: string;
  description: string;
  href: string;
  packageName: string;
  official?: boolean;
  beta?: boolean;
}

interface MarketplaceGridProps {
  official: Adapter[];
  community: Adapter[];
}

export const MarketplaceGrid = ({
  official,
  community,
}: MarketplaceGridProps) => {
  const [query, setQuery] = useState("");
  const lowerQuery = query.toLowerCase();

  const filter = (adapter: Adapter) =>
    !query ||
    adapter.name.toLowerCase().includes(lowerQuery) ||
    adapter.description.toLowerCase().includes(lowerQuery) ||
    adapter.packageName.toLowerCase().includes(lowerQuery);

  const filteredOfficial = official.filter(filter);
  const filteredCommunity = community.filter(filter);
  const noResults =
    filteredOfficial.length === 0 && filteredCommunity.length === 0;

  return (
    <>
      <MarketplaceSearch onSearch={setQuery} />

      {noResults ? (
        <p className="py-12 text-center text-muted-foreground">
          No adapters found matching &ldquo;{query}&rdquo;
        </p>
      ) : null}

      {filteredOfficial.length > 0 ? (
        <section className="grid gap-6">
          <div className="grid gap-1">
            <h2 className="font-semibold text-lg tracking-tight">
              Official
            </h2>
            <p className="text-muted-foreground text-sm">
              Published under <code>@chat-adapter/*</code> and maintained by
              Vercel.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredOfficial.map((adapter) => (
              <AdapterCard
                key={adapter.packageName}
                {...adapter}
              />
            ))}
          </div>
        </section>
      ) : null}

      {filteredCommunity.length > 0 ? (
        <section className="grid gap-6">
          <div className="grid gap-1">
            <h2 className="font-semibold text-lg tracking-tight">
              Community
            </h2>
            <p className="text-muted-foreground text-sm">
              Built by third-party developers and platform vendors.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCommunity.map((adapter) => (
              <AdapterCard
                key={adapter.packageName}
                {...adapter}
                badge={adapter.official ? "vendor-official" : undefined}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
};
