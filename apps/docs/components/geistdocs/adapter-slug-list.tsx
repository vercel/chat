import DynamicLink from "fumadocs-core/dynamic-link";
import {
  listPlatformAdapters,
  listStateAdapters,
  type CatalogAdapter,
} from "chat/adapters";

const adapterHref = (adapter: CatalogAdapter): string => {
  const group =
    adapter.group === "vendor-official" ? "vendor-official" : "official";
  return `/[lang]/adapters/${group}/${adapter.slug}`;
};

const byName = (first: CatalogAdapter, second: CatalogAdapter): number =>
  first.name.localeCompare(second.name);

const getGroups = () => [
  {
    label: "Official platform adapters",
    adapters: listPlatformAdapters()
      .filter((adapter) => adapter.group === "official")
      .sort(byName),
  },
  {
    label: "Vendor-official platform adapters",
    adapters: listPlatformAdapters()
      .filter((adapter) => adapter.group === "vendor-official")
      .sort(byName),
  },
  {
    label: "State adapters",
    adapters: [...listStateAdapters()].sort(byName),
  },
];

/**
 * Collapsible adapter slug list sourced from the `chat/adapters` catalog.
 */
export const AdapterSlugList = () => {
  const groups = getGroups();
  const adapterCount = groups.reduce(
    (count, group) => count + group.adapters.length,
    0
  );

  return (
    <details className="rounded-sm border bg-background p-3">
      <summary className="cursor-pointer font-medium text-sm">
        View available adapter slugs
      </summary>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {groups.map((group) => (
          <section key={group.label}>
            <h3 className="font-medium text-sm">{group.label}</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {group.adapters.map((adapter) => (
                <li key={adapter.slug}>
                  <DynamicLink
                    className="font-mono text-primary text-xs no-underline"
                    href={adapterHref(adapter)}
                  >
                    {adapter.slug}
                  </DynamicLink>
                  <span className="text-muted-foreground">
                    {" "}
                    - {adapter.name}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
};
