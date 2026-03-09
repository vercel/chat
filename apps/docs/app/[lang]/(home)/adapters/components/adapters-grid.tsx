"use client";

import { useState } from "react";
import { AdapterCard } from "./adapter-card";
import { AdaptersSearch } from "./adapters-search";
import { BuildYourOwnCard } from "./build-your-own-card";
import { type FilterTab, FilterTabs } from "./filter-tabs";

interface Adapter {
  beta?: boolean;
  comingSoon?: boolean;
  community?: boolean;
  description: string;
  icon?: string;
  name: string;
  packageName?: string;
  prs?: string[];
  slug: string;
  type: string;
  vendorOfficial?: boolean;
}

interface AdaptersGridProps {
  adapters: Adapter[];
}

export const AdaptersGrid = ({ adapters }: AdaptersGridProps) => {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const lowerQuery = query.toLowerCase();

  const filtered = adapters.filter((adapter) => {
    const matchesTab = activeTab === "all" || adapter.type === activeTab;
    const matchesQuery =
      !query ||
      adapter.name.toLowerCase().includes(lowerQuery) ||
      adapter.description.toLowerCase().includes(lowerQuery) ||
      adapter.packageName?.toLowerCase().includes(lowerQuery);
    return matchesTab && matchesQuery;
  });

  const official = filtered.filter((a) => !(a.community || a.vendorOfficial));
  const vendorOfficial = filtered.filter((a) => a.vendorOfficial);
  const community = filtered.filter((a) => a.community && !a.vendorOfficial);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <FilterTabs activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex-1">
          <AdaptersSearch onSearch={setQuery} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">
          {query ? (
            <>No adapters found matching &ldquo;{query}&rdquo;</>
          ) : (
            "No adapters found for this filter"
          )}
        </p>
      ) : null}

      {official.length > 0 ? (
        <section className="grid gap-6">
          <div className="grid gap-1">
            <h2 className="font-semibold text-lg tracking-tight">Official</h2>
            <p className="text-muted-foreground text-sm">
              Published under <code>@chat-adapter/*</code> and maintained by
              Vercel.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {official.map((adapter) => (
              <AdapterCard
                href={`/adapters/${adapter.slug}`}
                key={adapter.slug}
                {...adapter}
              />
            ))}
          </div>
        </section>
      ) : null}

      {vendorOfficial.length > 0 ? (
        <section className="grid gap-6">
          <div className="grid gap-1">
            <h2 className="font-semibold text-lg tracking-tight">
              Vendor Official
            </h2>
            <p className="text-muted-foreground text-sm">
              Built and maintained by the platform vendor.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vendorOfficial.map((adapter) => (
              <AdapterCard
                badge="vendor-official"
                href={`/adapters/${adapter.slug}`}
                key={adapter.slug}
                {...adapter}
              />
            ))}
            <BuildYourOwnCard />
          </div>
        </section>
      ) : null}

      {community.length > 0 ? (
        <section className="grid gap-6">
          <div className="grid gap-1">
            <h2 className="font-semibold text-lg tracking-tight">Community</h2>
            <p className="text-muted-foreground text-sm">
              Built by third-party developers.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {community.map((adapter) => (
              <AdapterCard
                href={`/adapters/${adapter.slug}`}
                key={adapter.slug}
                {...adapter}
              />
            ))}
            <BuildYourOwnCard />
          </div>
        </section>
      ) : null}
    </>
  );
};
